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

// ===== Export Requests Listener =====
onChildAdded(ref(db, "export_requests"), async (snapshot) => {
  const reqKey = snapshot.key;
  const req = snapshot.val();
  if(!req || !req.groupLink || !req.createdBy) return;
  if(req.status !== "pending") return;

  const userKey = req.createdBy;
  console.log(`Processing export request by ${userKey}: ${req.groupLink}`);

  // Load user's accounts
  const accountsSnap = await get(ref(db, "telegram_accounts"));
  const allAccounts = accountsSnap.val() || {};
  const accountsList = Object.values(allAccounts).filter(acc => acc.createdBy === userKey);
  if(!accountsList.length){
    await update(ref(db, `export_requests/${reqKey}`), { status:"error", error:"No accounts" });
    return;
  }

  for(const acc of accountsList){
    try{
      const client = new TelegramClient(
        new StringSession(acc.session),
        parseInt(acc.api_id),
        acc.api_hash,
        { connectionRetries:5 }
      );
      await client.start({ phoneNumber:null, password:null });
      console.log(`Logged in with API_ID ${acc.api_id}`);

      const groupEntity = await client.getEntity(req.groupLink);

      for await(const user of client.iterParticipants(groupEntity)){
        const reqSnap = await get(ref(db, `export_requests/${reqKey}`));
        if(reqSnap.val()?.status !== "pending") {
          console.log("Export cancelled, stopping...");
          return;
        }

        let profilePhoto = null;
        try{
          const photo = await client.downloadProfilePhoto(user, { file:"blob" });
          if(photo) profilePhoto = `data:image/jpeg;base64,${Buffer.from(photo).toString("base64")}`;
        } catch(e){ profilePhoto=null; }

        await push(ref(db, `exported_members/${userKey}`), {
          id:user.id.toString(),
          username:user.username||null,
          firstName:user.firstName||null,
          lastName:user.lastName||null,
          profilePhoto,
          groupLink:req.groupLink,
          createdAt:Date.now()
        });
      }

      await update(ref(db, `export_requests/${reqKey}`), { status:"done", processedAt:Date.now() });
      console.log(`✅ Exported members for ${req.groupLink}`);
      break;

    } catch(err){
      console.error(`❌ Failed with account ${acc.api_id}: ${err.message}`);
      await update(ref(db, `export_requests/${reqKey}`), { status:"error", error:err.message });
    }
  }
});

// ===== Add Members Listener =====
onChildAdded(ref(db, "add_members_requests"), async (snapshot) => {
  const reqKey = snapshot.key;
  const req = snapshot.val();
  if(!req || req.status!=="pending") return;

  const targetGroupLink = req.targetGroup;
  const membersToAdd = req.members || [];
  const userKey = req.createdBy;

  // Load user's accounts
  const accountsSnap = await get(ref(db, "telegram_accounts"));
  const allAccounts = accountsSnap.val() || {};
  const accountsList = Object.values(allAccounts).filter(acc => acc.createdBy === userKey);
  if(!accountsList.length){
    await update(ref(db, `add_members_requests/${reqKey}`), { status:"error", error:"No accounts" });
    return;
  }

  let accountIndex = 0;
  for(const member of membersToAdd){
    const acc = accountsList[accountIndex % accountsList.length]; // rotate accounts
    accountIndex++;

    try{
      const client = new TelegramClient(
        new StringSession(acc.session),
        parseInt(acc.api_id),
        acc.api_hash,
        { connectionRetries:5 }
      );
      await client.start({ phoneNumber:null, password:null });
      const targetEntity = await client.getEntity(targetGroupLink);

      if(member.username){
        await client.addUser(targetEntity, member.username);
      } else if(member.id && member.accessHash){
        await client.addUser(targetEntity, { userId:member.id, accessHash:member.accessHash });
      }

      console.log(`Added ${member.username || member.id} to ${targetGroupLink}`);
      await new Promise(r => setTimeout(r, 5000)); // delay

    } catch(err){
      console.error(`❌ Failed to add ${member.username || member.id}: ${err.message}`);
    }
  }

  await update(ref(db, `add_members_requests/${reqKey}`), { status:"done", processedAt:Date.now() });
  console.log(`✅ Finished adding members to ${targetGroupLink}`);
});

// ===== Express Server =====
const webApp = express();
const PORT = process.env.PORT || 3000;
webApp.get("/", (req,res)=>res.send("Telegram Node.js Worker PRO+++ Live"));
webApp.listen(PORT, ()=>console.log(`Server running on port ${PORT}`));
