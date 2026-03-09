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
   EXPORT MEMBERS WORKER + PROFILE PHOTO
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
    await update(ref(db, `export_requests/${reqKey}`), { status: "error", error: "No accounts available" });
    return;
  }

  for (const acc of accounts) {
    try {
      const client = new TelegramClient(new StringSession(acc.session), parseInt(acc.api_id), acc.api_hash, { connectionRetries: 5 });
      await client.start({ phoneNumber: null, password: null });
      console.log(`🔑 Logged with API_ID ${acc.api_id}`);

      const group = await client.getEntity(groupLink);

      for await (const user of client.iterParticipants(group)) {
        const reqCheck = await get(ref(db, `export_requests/${reqKey}`));
        if (reqCheck.val()?.status !== "pending") return;

        // Pull profile photo
        let profilePhoto = null;
        try {
          if(user.photo) {
            const file = await client.downloadFile(user.photo.photoSmall, { dcId: user.photo.dcId });
            profilePhoto = `data:image/jpeg;base64,${file.toString('base64')}`;
          }
        } catch(e){}

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
      console.log(`✅ Export Completed: ${groupLink}`);
      break;

    } catch (err) {
      console.log(`❌ Account failed ${acc.api_id}: ${err.message}`);
      await update(ref(db, `export_requests/${reqKey}`), { status: "error", error: err.message });
    }
  }
});

/* =====================================================
   ADD MEMBERS WORKER + SKIP EXISTING + DELAY + SWITCH
===================================================== */
onChildAdded(ref(db, "add_members_requests"), async (snapshot) => {
  const reqKey = snapshot.key;
  const req = snapshot.val();
  if (!req || req.status !== "pending") return;
  const { targetGroup, members, createdBy } = req;

  console.log(`📥 Add Members Request → ${targetGroup}`);

  const accountsSnap = await get(ref(db, "telegram_accounts"));
  const accounts = Object.values(accountsSnap.val() || {}).filter(acc => acc.createdBy === createdBy && acc.session);
  if (!accounts.length) {
    await update(ref(db, `add_members_requests/${reqKey}`), { status: "error", error: "No accounts available" });
    return;
  }

  let accountIndex = 0; // rotate accounts
  const clientCache = {};

  const groupEntity = {};
  for (const m of members) {
    try {
      const acc = accounts[accountIndex];
      let client = clientCache[acc.api_id];
      if(!client){
        client = new TelegramClient(new StringSession(acc.session), parseInt(acc.api_id), acc.api_hash, { connectionRetries: 5 });
        await client.start({ phoneNumber: null, password: null });
        clientCache[acc.api_id] = client;
        console.log(`🔑 Logged with API_ID ${acc.api_id}`);
      }

      // get group entity once
      if(!groupEntity[acc.api_id]){
        groupEntity[acc.api_id] = await client.getEntity(targetGroup);
      }

      const group = groupEntity[acc.api_id];

      // ✅ Check if user already in group
      let inGroup = false;
      try {
        const participants = await client.getParticipants(group, { limit: 0 });
        inGroup = participants.some(p => p.id.toString() === m.id);
      } catch(e){}

      if(inGroup){
        console.log(`⚠️ Skipped ${m.username || m.id} (already in group)`);
        continue;
      }

      const user = new Api.InputUser({ userId: BigInt(m.id), accessHash: BigInt(m.accessHash || 0) });
      await client.invoke(new Api.channels.InviteToChannel({ channel: group, users: [user] }));

      await push(ref(db, `added_members/${createdBy}`), {
        username: m.username || null,
        id: m.id,
        group: targetGroup,
        addedBy: acc.api_id,
        createdAt: Date.now()
      });

      console.log(`✅ Added ${m.username || m.id}`);

      // 🔹 Delay 30s after successful add
      for(let sec=30; sec>0; sec--){
        process.stdout.write(`⏳ Waiting ${sec}s\r`);
        await sleep(1000);
      }

      // 🔹 Switch to next account
      accountIndex = (accountIndex + 1) % accounts.length;

    } catch(err){
      console.log(`❌ Failed ${m.username || m.id} → ${err.message}`);
      accountIndex = (accountIndex + 1) % accounts.length;
      continue;
    }
  }

  await update(ref(db, `add_members_requests/${reqKey}`), { status: "done", processedAt: Date.now() });
  console.log(`🎉 Add Members Completed`);
});

/* =====================================================
   EXPRESS SERVER
===================================================== */
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => {
  res.send(`<h1>Telegram Worker PRO+++</h1><p>Status: Running ✅</p><p>Export + Add Members Active</p>`);
});
app.listen(PORT, () => console.log(`🌐 Server running on port ${PORT}`));
