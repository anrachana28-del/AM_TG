import 'dotenv/config';
import express from "express";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, push, update, onChildAdded } from "firebase/database";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

// ===== Firebase =====
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DB_URL,
  projectId: process.env.FIREBASE_PROJECT_ID
};
const appFirebase = initializeApp(firebaseConfig);
const db = getDatabase(appFirebase);

// ===== Telegram Add Worker with console list =====
onChildAdded(ref(db,"add_requests"), async snap=>{
  const req = snap.val();
  if(!req || req.status!=="pending") return;
  const { groupLink, createdBy } = req;

  console.log(`\n📌 New Add Request by ${createdBy}: ${groupLink}`);

  // Load members
  const membersSnap = await get(ref(db, `exported_members/${createdBy}`));
  const members = Object.values(membersSnap.val()||{});
  console.log(`Found ${members.length} members to add:`);

  members.forEach((m,i)=>console.log(`${i+1}. ${m.username||m.id} (${m.firstName||''} ${m.lastName||''})`));

  // Load accounts
  const accountsSnap = await get(ref(db,"telegram_accounts"));
  const accounts = Object.values(accountsSnap.val()||{}).filter(a=>a.createdBy===createdBy && a.session);
  if(!accounts.length){
    await update(ref(db, `add_requests/${snap.key}`), {status:"error", error:"No accounts"});
    console.log("❌ No accounts available for this user");
    return;
  }

  const acc = accounts[0]; // pick first account
  const client = new TelegramClient(
    new StringSession(acc.session),
    parseInt(acc.api_id),
    acc.api_hash,
    {connectionRetries:5}
  );
  await client.start({phoneNumber:null,password:null});
  console.log(`✅ Logged in with API_ID: ${acc.api_id}`);

  const group = await client.getEntity(groupLink);
  let addedCount = 0;

  console.log("\n➕ Adding members:");

  for(const m of members){
    try{
      await client.addUserToChannel(group, m.id);
      await push(ref(db,"added_members"), {...m, groupLink, createdAt:Date.now()});
      addedCount++;
      console.log(`   ${addedCount}. ${m.username||m.id} → Added ✅`);
    } catch(e){
      console.log(`   ${addedCount+1}. ${m.username||m.id} → Failed ⚠️ (${e.message})`);
    }
  }

  await update(ref(db, `add_requests/${snap.key}`), {status:"done", processedAt:Date.now()});
  console.log(`\n🎯 All members processed for group: ${groupLink}\n`);
});

// ===== Express Server =====
const webApp = express();
const PORT = process.env.PORT||3000;
webApp.get("/", (req,res)=>res.send("Telegram Add Worker Live"));
webApp.listen(PORT, ()=>console.log(`Server running on port ${PORT}`));
