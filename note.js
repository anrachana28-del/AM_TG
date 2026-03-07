import 'dotenv/config';
import express from "express";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, push, update, onChildAdded } from "firebase/database";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { Api } from "telegram";

// ===== Firebase config =====
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DB_URL,
  projectId: process.env.FIREBASE_PROJECT_ID,
};
const appFirebase = initializeApp(firebaseConfig);
const db = getDatabase(appFirebase);

// ===== Add Members Listener =====
onChildAdded(ref(db, "add_requests"), async (snapshot) => {
  const reqKey = snapshot.key;
  const req = snapshot.val();
  if(!req || !req.targetGroup || !req.createdBy || !req.members?.length) return;
  if(req.status !== "pending") return;

  const userKey = req.createdBy;
  console.log(`Processing Add Members request by ${userKey} → ${req.targetGroup}`);

  // Load accounts
  const accountsSnap = await get(ref(db, "telegram_accounts"));
  const allAccounts = accountsSnap.val() || {};
  const accountsList = Object.values(allAccounts).filter(acc => acc.createdBy === userKey);
  if(!accountsList.length){
    await update(ref(db, `add_requests/${reqKey}`), { status:"error", error:"No accounts" });
    return;
  }

  // Loop through members
  let memberIndex = 0;
  for(const member of req.members){
    const acc = accountsList[memberIndex % accountsList.length]; // rotate accounts

    try{
      const client = new TelegramClient(
        new StringSession(acc.session),
        parseInt(acc.api_id),
        acc.api_hash,
        { connectionRetries:5 }
      );
      await client.start({ phoneNumber:null, password:null });
      console.log(`Logged in with API_ID ${acc.api_id}`);

      const targetEntity = await client.getEntity(req.targetGroup);
      const userEntity = await client.getEntity(member.username || member.id);

      await client.invoke(new Api.channels.InviteToChannel({
        channel: targetEntity,
        users: [userEntity]
      }));

      console.log(`✅ Added @${member.username} to ${req.targetGroup}`);
      await push(ref(db, `add_logs/${userKey}`), {
        member: member.username || member.id,
        status: "success",
        timestamp: Date.now(),
        accountUsed: acc.api_id
      });

      // Wait 30s before next member
      await new Promise(res => setTimeout(res, 30*1000));

    } catch(err){
      console.error(`❌ Failed to add ${member.username}: ${err.message}`);
      await push(ref(db, `add_logs/${userKey}`), {
        member: member.username || member.id,
        status: "error",
        error: err.message,
        timestamp: Date.now(),
        accountUsed: acc.api_id
      });
    }

    memberIndex++;
  }

  // Mark request done
  await update(ref(db, `add_requests/${reqKey}`), { status:"done", processedAt:Date.now() });
  console.log(`✅ Finished Add Members request for ${req.targetGroup}`);
});

// ===== Express Server =====
const webApp = express();
const PORT = process.env.PORT || 3000;
webApp.get("/", (req,res)=>res.send("Telegram Node.js Worker PRO+++ Live"));
webApp.listen(PORT, ()=>console.log(`Server running on port ${PORT}`));
