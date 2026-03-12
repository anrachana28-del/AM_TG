// worker.js
import 'dotenv/config';
import express from "express";
import admin from "firebase-admin";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";

// ===== Firebase Admin =====
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DB_URL
});
const db = admin.database();

// ===== Helpers =====
const sleep = ms => new Promise(r => setTimeout(r, ms));
const safeBigInt = (val) => (val ? BigInt(val) : BigInt(0));

// ===== Load Telegram Accounts =====
async function loadAccounts(createdBy) {
  const snapshot = await db.ref("telegram_accounts").once("value");
  return Object.values(snapshot.val() || {})
    .filter(acc => acc.createdBy === createdBy && acc.session);
}

// ===== Export Members Worker =====
db.ref("export_requests").on("child_added", async (snap) => {
  const reqKey = snap.key;
  const req = snap.val();
  if (!req || req.status !== "pending") return;

  const { groupLink, createdBy } = req;
  console.log(`🚀 Export Request from ${createdBy} → ${groupLink}`);

  const accounts = await loadAccounts(createdBy);
  if (!accounts.length) {
    await db.ref(`export_requests/${reqKey}`).update({ status: "error", error: "No accounts available" });
    return;
  }

  for (const acc of accounts) {
    try {
      const client = new TelegramClient(new StringSession(acc.session), parseInt(acc.api_id), acc.api_hash, { connectionRetries: 5 });
      await client.start({ phoneNumber: null, password: null });

      const group = await client.getEntity(groupLink);
      for await (const user of client.iterParticipants(group)) {
        let profilePhoto = "https://via.placeholder.com/100?text=No+Photo";
        try {
          const photoBuffer = await client.downloadProfilePhoto(user, { file: "memory" });
          if (photoBuffer) profilePhoto = `data:image/jpeg;base64,${Buffer.from(photoBuffer).toString("base64")}`;
        } catch {}
        await db.ref(`exported_members/${createdBy}`).push({
          id: user.id.toString(),
          accessHash: user.accessHash?.toString() || null,
          username: user.username || null,
          firstName: user.firstName || null,
          lastName: user.lastName || null,
          profilePhoto,
          groupLink,
          createdAt: Date.now()
        });
      }

      await db.ref(`export_requests/${reqKey}`).update({ status: "done", processedAt: Date.now() });
      console.log(`✅ Export Completed: ${groupLink}`);
      break;

    } catch (err) {
      console.log(`❌ Account failed ${acc.api_id}: ${err.message}`);
      await db.ref(`export_requests/${reqKey}`).update({ status: "error", error: err.message });
    }
  }
});

// ===== Add Members Worker =====
db.ref("add_members_requests").on("child_added", async (snap) => {
  const reqKey = snap.key;
  const req = snap.val();
  if (!req || req.status !== "pending") return;

  const { targetGroup, members, createdBy } = req;
  console.log(`📥 Add Members Request → ${targetGroup}`);

  const accounts = await loadAccounts(createdBy);
  if (!accounts.length) {
    await db.ref(`add_members_requests/${reqKey}`).update({ status: "error", error: "No accounts available" });
    return;
  }

  let currentIndex = 0;
  for (const m of members) {
    const acc = accounts[currentIndex];
    currentIndex = (currentIndex + 1) % accounts.length;

    try {
      const client = new TelegramClient(new StringSession(acc.session), parseInt(acc.api_id), acc.api_hash, { connectionRetries: 5 });
      await client.start({ phoneNumber: null, password: null });

      // Auto join group
      try { await client.invoke(new Api.channels.JoinChannel({ channel: targetGroup })); } catch {}

      const user = new Api.InputUser({ userId: safeBigInt(m.id), accessHash: safeBigInt(m.accessHash) });

      // FloodWait-aware add
      let added = false;
      while (!added) {
        try {
          await client.invoke(new Api.channels.InviteToChannel({ channel: targetGroup, users: [user] }));
          added = true;
        } catch (err) {
          if (err.errorMessage && err.errorMessage.includes("FLOOD_WAIT")) {
            const waitSec = parseInt(err.errorMessage.match(/\d+/)?.[0] || 30);
            console.log(`⚠️ FloodWait: wait ${waitSec}s`);
            await sleep((waitSec + 2) * 1000);
          } else {
            throw err;
          }
        }
      }

      // Log success
      await db.ref(`added_members/${createdBy}`).push({
        username: m.username || null,
        id: m.id,
        group: targetGroup,
        addedBy: acc.api_id,
        createdAt: Date.now()
      });
      console.log(`✅ Added ${m.username || m.id}`);
      await sleep(3000);

    } catch (err) {
      console.log(`❌ Failed ${m.username || m.id}: ${err.message}`);
    }
  }

  await db.ref(`add_members_requests/${reqKey}`).update({ status: "done", processedAt: Date.now() });
  console.log(`🎉 Add Members Completed`);
});

// ===== Express Server =====
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req,res) => res.send("<h1>Telegram PRO Worker running ✅</h1><p>Export + Add Members Active</p>"));
app.listen(PORT, () => console.log(`🌐 Server running on port ${PORT}`));
