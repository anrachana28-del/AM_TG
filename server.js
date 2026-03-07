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
  projectId: process.env.FIREBASE_PROJECT_ID
};
const appFirebase = initializeApp(firebaseConfig);
const db = getDatabase(appFirebase);

// ===== Express server =====
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req,res)=>res.send("🚀 Telegram Worker PRO+++ Live"));
app.listen(PORT, ()=>console.log(`Server running on port ${PORT}`));

// ===== Add Members Worker =====
console.log("🚀 Telegram Add Worker Started");

onChildAdded(ref(db,"add_requests"), async snap=>{
  const reqKey = snap.key;
  const req = snap.val();
  if(!req || req.status!=="pending") return;
  const { createdBy, groupLink } = req;

  try {
    // Load accounts for this user
    const accountsSnap = await get(ref(db,"telegram_accounts"));
    const accounts = Object.values(accountsSnap.val()||{}).filter(a=>a.createdBy===createdBy && a.session);
    if(!accounts.length){
      await update(ref(db, `add_requests/${reqKey}`), {status:"error", error:"No accounts"});
      return;
    }

    // Load members to add
    const membersSnap = await get(ref(db, `exported_members/${createdBy}`));
    const members = [];
    membersSnap.forEach(c=>{
      const m = c.val();
      if(m) members.push(m);
    });
    if(!members.length){
      await update(ref(db, `add_requests/${reqKey}`), {status:"error", error:"No members to add"});
      return;
    }

    await update(ref(db, `add_requests/${reqKey}`), {status:"processing", startedAt:Date.now()});

    let memberIndex = 0;
    const perAccountLimit = 50;

    for(const acc of accounts){
      const client = new TelegramClient(new StringSession(acc.session), parseInt(acc.api_id), acc.api_hash, {connectionRetries:5});
      await client.start({phoneNumber:null,password:null});
      console.log(`✅ Logged in with account ${acc.api_id}`);

      const groupEntity = await client.getEntity(groupLink);
      let addedCount = 0;

      while(memberIndex < members.length && addedCount < perAccountLimit){
        const m = members[memberIndex];
        try{
          await client.invoke(new Api.channels.InviteToChannel({
            channel: groupEntity,
            users: [{userId: m.id}]
          }));
          await push(ref(db, `added_members/${createdBy}`), {...m, groupLink, createdAt:Date.now()});
          console.log(`➕ Added: ${m.username||m.id}`);
          addedCount++;
          memberIndex++;

          // Delay 20s per member
          console.log("⏱ Waiting 20s to avoid flood...");
          await new Promise(r=>setTimeout(r, 20000));

        }catch(e){
          console.log(`❌ Failed to add ${m.username||m.id}: ${e.message}`);
          if(e.message.includes("FLOOD_WAIT")){
            const wait = parseInt(e.message.match(/(\d+)/)[0])*1000;
            console.log(`💤 Flood wait ${wait/1000}s`);
            await new Promise(r=>setTimeout(r, wait));
          } else {
            memberIndex++;
          }
        }
      }

      console.log(`✅ Account ${acc.api_id} added ${addedCount} members`);
    }

    await update(ref(db, `add_requests/${reqKey}`), {status:"done", processedAt:Date.now()});
    console.log(`✅ All members added for request by ${createdBy}`);

  } catch(err){
    console.error("❌ Worker Error:", err.message);
    await update(ref(db, `add_requests/${reqKey}`), {status:"error", error:err.message});
  }
});
