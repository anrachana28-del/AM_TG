// note.js - Full Telegram Worker with Live Status Updates
import 'dotenv/config';
import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, push, update, onChildAdded } from "firebase/database";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

// ===== Firebase Config =====
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DB_URL,
  projectId: process.env.FIREBASE_PROJECT_ID
};
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ===== Delay Helper =====
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ===== Update Account Status =====
async function updateAccountStatus(accKey, status) {
  await update(ref(db, `telegram_accounts/${accKey}`), { status, updatedAt: Date.now() });
}

// ===== EXPORT MEMBERS WORKER =====
onChildAdded(ref(db, "export_requests"), async (snapshot) => {
  const reqKey = snapshot.key;
  const req = snapshot.val();
  if (!req || req.status !== "pending") return;

  const { groupLink, createdBy } = req;
  console.log(`🚀 Export Request from ${createdBy} → ${groupLink}`);

  const accountsSnap = await get(ref(db, "telegram_accounts"));
  const accounts = Object.entries(accountsSnap.val() || {})
    .filter(([key, acc]) => acc.createdBy === createdBy && acc.session);

  if (!accounts.length) {
    await update(ref(db, `export_requests/${reqKey}`), { status: "error", error: "No accounts available" });
    return;
  }

  for (const [accKey, acc] of accounts) {
    try {
      const client = new TelegramClient(new StringSession(acc.session), parseInt(acc.api_id), acc.api_hash, { connectionRetries: 5 });
      await client.start({ phoneNumber: null, password: null });
      await updateAccountStatus(accKey, "✅ Logged in for Export");

      const group = await client.getEntity(groupLink);
      for await (const user of client.iterParticipants(group)) {
        const reqCheck = await get(ref(db, `export_requests/${reqKey}`));
        if (reqCheck.val()?.status !== "pending") return;

        // Profile photo
        let profilePhoto = "https://via.placeholder.com/100?text=No+Photo";
        try {
          const photoBlob = await client.downloadProfilePhoto(user, { file: "blob" });
          if (photoBlob) profilePhoto = `data:image/jpeg;base64,${Buffer.from(photoBlob).toString("base64")}`;
        } catch (e) {}

        await push(ref(db, `exported_members/${createdBy}`), {
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

      await update(ref(db, `export_requests/${reqKey}`), { status: "done", processedAt: Date.now() });
      await updateAccountStatus(accKey, "✅ Export Done");
      console.log(`✅ Export Completed: ${groupLink}`);
      break;

    } catch (err) {
      console.log(`❌ Account failed ${acc.api_id}: ${err.message}`);
      await updateAccountStatus(accKey, `❌ Export Error | ${err.message}`);
      await update(ref(db, `export_requests/${reqKey}`), { status: "error", error: err.message });
    }
  }
});

// ===== ADD MEMBERS WORKER =====
onChildAdded(ref(db, "add_members_requests"), async (snapshot) => {
  const reqKey = snapshot.key;
  const req = snapshot.val();
  if (!req || req.status !== "pending") return;

  const { targetGroup, members, createdBy } = req;
  console.log(`📥 Add Members Request → ${targetGroup}`);

  const accountsSnap = await get(ref(db, "telegram_accounts"));
  const accounts = Object.entries(accountsSnap.val() || {})
    .filter(([key, acc]) => acc.createdBy === createdBy && acc.session);

  if (!accounts.length) {
    await update(ref(db, `add_members_requests/${reqKey}`), { status: "error", error: "No accounts available" });
    return;
  }

  for (const [accKey, acc] of accounts) {
    try {
      const client = new TelegramClient(new StringSession(acc.session), parseInt(acc.api_id), acc.api_hash, { connectionRetries: 5 });
      await client.start({ phoneNumber: null, password: null });
      await updateAccountStatus(accKey, "✅ Logged in for Add Members");

      const group = await client.getEntity(targetGroup);

      for (const m of members) {
        try {
          await updateAccountStatus(accKey, `⏳ Adding ${m.username || m.id}`);
          const user = new Api.InputUser({
            userId: BigInt(m.id),
            accessHash: BigInt(m.accessHash || 0)
          });
          await client.invoke(new Api.channels.InviteToChannel({ channel: group, users: [user] }));

          await push(ref(db, `added_members/${createdBy}`), {
            username: m.username || null,
            id: m.id,
            group: targetGroup,
            addedBy: acc.api_id,
            createdAt: Date.now()
          });

          await updateAccountStatus(accKey, `✅ Added ${m.username || m.id}`);
          await sleep(3000); // delay per member

        } catch (err) {
          console.log(`❌ Failed ${m.username || m.id} → ${err.message}`);

          if (err.errorMessage?.includes("FLOOD_WAIT")) {
            const seconds = parseInt(err.errorMessage.match(/\d+/)?.[0] || 60);
            await updateAccountStatus(accKey, `⏳ FloodWait ${seconds}s`);
            await sleep(seconds * 1000);
          } else {
            await updateAccountStatus(accKey, `❌ Failed ${m.username || m.id} | ${err.message}`);
          }
        }
      }

      await update(ref(db, `add_members_requests/${reqKey}`), { status: "done", processedAt: Date.now() });
      await updateAccountStatus(accKey, "✅ Add Members Done");
      console.log(`🎉 Add Members Completed`);
      break;

    } catch (err) {
      console.log(`❌ Account failed ${acc.api_id}: ${err.message}`);
      await updateAccountStatus(accKey, `❌ Account Error | ${err.message}`);
      continue;
    }
  }
});

console.log("🚀 Telegram Worker LIVE - Export + Add Members + Live Status");
