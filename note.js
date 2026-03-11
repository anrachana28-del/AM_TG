import 'dotenv/config';
import express from "express";
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

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);

// ===== Delay Helper =====
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* =====================================================
   EXPORT MEMBERS WORKER
===================================================== */
onChildAdded(ref(db, "export_requests"), async (snapshot) => {

  const reqKey = snapshot.key;
  const req = snapshot.val();
  if (!req || req.status !== "pending") return;

  const { groupLink, createdBy } = req;
  console.log(`🚀 Export Request from ${createdBy} → ${groupLink}`);

  const accountsSnap = await get(ref(db, "telegram_accounts"));
  const accounts = Object.values(accountsSnap.val() || {})
    .filter(acc => acc.createdBy === createdBy && acc.session);

  if (!accounts.length) {
    await update(ref(db, `export_requests/${reqKey}`), {
      status: "error",
      error: "No accounts available"
    });
    return;
  }

  for (const acc of accounts) {
    try {
      const client = new TelegramClient(
        new StringSession(acc.session),
        parseInt(acc.api_id),
        acc.api_hash,
        { connectionRetries: 5 }
      );

      await client.start({ phoneNumber: null, password: null });
      console.log(`🔑 Logged with ${acc.phone}`);

      const group = await client.getEntity(groupLink);

      for await (const user of client.iterParticipants(group)) {

        const reqCheck = await get(ref(db, `export_requests/${reqKey}`));
        if (reqCheck.val()?.status !== "pending") {
          console.log("🛑 Export cancelled");
          return;
        }

        let profilePhoto = "https://via.placeholder.com/100?text=No+Photo";
        try {
          const photoBlob = await client.downloadProfilePhoto(user, { file: "blob" });
          if (photoBlob) profilePhoto = `data:image/jpeg;base64,${Buffer.from(photoBlob).toString("base64")}`;
        } catch {}

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

      await update(ref(db, `export_requests/${reqKey}`), {
        status: "done",
        processedAt: Date.now()
      });

      console.log(`✅ Export Completed: ${groupLink}`);
      break;

    } catch (err) {
      console.log(`❌ Account failed ${acc.phone}: ${err.message}`);
      await update(ref(db, `export_requests/${reqKey}`), {
        status: "error",
        error: err.message
      });
    }
  }
});


/* =====================================================
   ADD MEMBERS WORKER
===================================================== */
onChildAdded(ref(db, "add_members_requests"), async (snapshot) => {

  const reqKey = snapshot.key;
  const req = snapshot.val();
  if (!req || req.status !== "pending") return;

  const { targetGroup, members, createdBy } = req;
  console.log(`📥 Add Members Request → ${targetGroup}`);

  const accountsSnap = await get(ref(db, "telegram_accounts"));
  const accounts = Object.values(accountsSnap.val() || {})
    .filter(acc => acc.createdBy === createdBy && acc.session);

  if (!accounts.length) {
    await update(ref(db, `add_members_requests/${reqKey}`), {
      status: "error",
      error: "No accounts available"
    });
    return;
  }

  for (const acc of accounts) {
    try {
      const client = new TelegramClient(
        new StringSession(acc.session),
        parseInt(acc.api_id),
        acc.api_hash,
        { connectionRetries: 5 }
      );

      await client.start({ phoneNumber: null, password: null });
      console.log(`🔑 Logged with ${acc.phone}`);

      const group = await client.getEntity(targetGroup);

      for (const m of members) {
        try {
          const user = new Api.InputUser({
            userId: BigInt(m.id),
            accessHash: BigInt(m.accessHash || 0)
          });

          await client.invoke(new Api.channels.InviteToChannel({
            channel: group,
            users: [user]
          }));

          await push(ref(db, `added_members/${createdBy}`), {
            username: m.username || null,
            id: m.id,
            group: targetGroup,
            addedBy: acc.phone,
            status: "success",
            reason: null,
            waitUntil: null,
            createdAt: Date.now()
          });

          console.log(`✅ Added ${m.username || m.id}`);
          await sleep(3000);

        } catch (err) {
          // Detect PEER_FLOOD or FLOOD_WAIT
          let waitUntil = null;
          if(err.errorMessage?.includes("PEER_FLOOD") || err.errorMessage?.includes("FLOOD_WAIT")){
            waitUntil = Date.now() + 5*60*1000; // example wait 5min
          }

          await push(ref(db, `added_members/${createdBy}`), {
            username: m.username || null,
            id: m.id,
            group: targetGroup,
            addedBy: acc.phone,
            status: "fail",
            reason: err.errorMessage || "Unknown",
            waitUntil,
            createdAt: Date.now()
          });

          console.log(`❌ Failed ${m.username || m.id} → ${err.errorMessage || "Unknown"}`);
        }
      }

      await update(ref(db, `add_members_requests/${reqKey}`), {
        status: "done",
        processedAt: Date.now()
      });

      console.log(`🎉 Add Members Completed`);
      break;

    } catch (err) {
      console.log(`❌ Account failed ${acc.phone}: ${err.message}`);
      continue;
    }
  }
});


/* =====================================================
   EXPRESS SERVER
===================================================== */
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send(`
    <h1>Telegram Worker PRO+++</h1>
    <p>Status: Running ✅</p>
    <p>Export + Add Members Active</p>
  `);
});

app.listen(PORT, () => {
  console.log(`🌐 Server running on port ${PORT}`);
});
