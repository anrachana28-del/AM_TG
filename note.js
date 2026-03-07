import 'dotenv/config';
import express from "express";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, push, update, onChildAdded } from "firebase/database";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

// ===== Firebase config =====
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DB_URL,
  projectId: process.env.FIREBASE_PROJECT_ID,
};
const appFirebase = initializeApp(firebaseConfig);
const db = getDatabase(appFirebase);

// ===== Add Members Listener (Safe, 30s delay per member) =====
onChildAdded(ref(db, "add_members_requests"), async (snapshot) => {
  const reqKey = snapshot.key;
  const req = snapshot.val();
  if (!req || req.status !== "pending") return;

  const members = req.members || [];
  if (!members.length) {
    await update(ref(db, `add_members_requests/${reqKey}`), { status: "error", error: "No members" });
    return;
  }

  // Load user accounts
  const accountsSnap = await get(ref(db, "telegram_accounts"));
  const allAccounts = accountsSnap.val() || {};
  const accountsList = Object.values(allAccounts).filter(acc => acc.createdBy === req.createdBy);
  if (!accountsList.length) {
    await update(ref(db, `add_members_requests/${reqKey}`), { status: "error", error: "No accounts" });
    return;
  }

  let accountIndex = 0;

  for (const member of members) {
    try {
      const acc = accountsList[accountIndex % accountsList.length]; // rotate accounts
      accountIndex++;

      const client = new TelegramClient(
        new StringSession(acc.session),
        parseInt(acc.api_id),
        acc.api_hash,
        { connectionRetries: 5 }
      );
      await client.start({ phoneNumber: null, password: null });

      const targetEntity = await client.getEntity(req.targetGroup);
      const userEntity = await client.getEntity(member.username || member.id);

      await client.addUserToChannel(targetEntity, userEntity);
      console.log(`✅ Added @${member.username} using account ${acc.api_id}`);

      // Update Firebase logs
      await push(ref(db, `add_members_requests/${reqKey}/logs`), {
        member: member.username,
        status: "added",
        timestamp: Date.now()
      });

      // Delay 30 seconds before next member
      await new Promise(resolve => setTimeout(resolve, 30 * 1000));

    } catch (err) {
      console.error(`❌ Failed to add ${member.username}: ${err.message}`);
      await push(ref(db, `add_members_requests/${reqKey}/logs`), {
        member: member.username,
        status: "error",
        error: err.message,
        timestamp: Date.now()
      });
    }
  }

  await update(ref(db, `add_members_requests/${reqKey}`), { status: "done", processedAt: Date.now() });
  console.log(`✅ Finished adding members for request ${reqKey}`);
});

// ===== Express Server =====
const webApp = express();
const PORT = process.env.PORT || 3000;
webApp.get("/", (req,res)=>res.send("Telegram Node.js Worker PRO+++ Live"));
webApp.listen(PORT, ()=>console.log(`Server running on port ${PORT}`));
