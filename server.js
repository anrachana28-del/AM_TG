// server.js
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
  projectId: process.env.FIREBASE_PROJECT_ID
};
const appFirebase = initializeApp(firebaseConfig);
const db = getDatabase(appFirebase);

// ===== Telegram Add-Member Worker =====
console.log("🔹 Telegram Add-Member Worker Started");

onChildAdded(ref(db,"add_requests"), async snap=>{
  const req = snap.val();
  if(!req || req.status !== "pending") return;
  const { groupLink, createdBy, members } = req;
  console.log(`Processing add request for group ${groupLink} by ${createdBy}`);

  try {
    // Load user accounts
    const accountsSnap = await get(ref(db,"telegram_accounts"));
    const accounts = Object.values(accountsSnap.val()||{}).filter(a => a.createdBy === createdBy && a.session);
    if(!accounts.length){
      await update(ref(db, `add_requests/${snap.key}`), {status:"error", error:"No accounts"});
      console.log("❌ No accounts available for user", createdBy);
      return;
    }

    // Use first available account
    const acc = accounts[0];
    const client = new TelegramClient(
      new StringSession(acc.session),
      parseInt(acc.api_id),
      acc.api_hash,
      { connectionRetries:5 }
    );
    await client.start({ phoneNumber:null, password:null });
    console.log(`✅ Logged in with API_ID ${acc.api_id}`);

    // Get Telegram group
    const group = await client.getEntity(groupLink);

    // Add members
    for(const m of members){
      try {
        await client.addUserToChannel(group, m.id);
        await push(ref(db, `added_members/${createdBy}`), {
          ...m,
          groupLink,
          createdAt: Date.now()
        });
        console.log(`Added ${m.username||m.id} to ${groupLink}`);
      } catch(e){
        console.error(`Failed to add ${m.username||m.id}: ${e.message}`);
      }
    }

    // Mark request done
    await update(ref(db, `add_requests/${snap.key}`), {status:"done", processedAt:Date.now()});
    console.log(`✅ Finished adding members to ${groupLink}`);
  } catch(e){
    console.error("Error processing request:", e.message);
    await update(ref(db, `add_requests/${snap.key}`), {status:"error", error:e.message});
  }
});

// ===== Small Express Server for Render =====
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req,res)=>{
  res.send("Telegram Worker Running ✅");
});

app.listen(PORT, ()=>{
  console.log(`Server listening on port ${PORT}`);
});
