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
  console.log(`Processing request by ${userKey}: ${req.groupLink}`);

  // Load Telegram accounts for this user
  const accountsSnap = await get(ref(db, "telegram_accounts"));
  const allAccounts = accountsSnap.val() || {};
  const accountsList = Object.values(allAccounts).filter(acc => acc.createdBy === userKey);

  if(!accountsList.length){
    await update(ref(db, `export_requests/${reqKey}`), { status:"error", error:"No accounts" });
    return;
  }

  // Get the user's target group (pick first one or default)
  const userGroupsSnap = await get(ref(db, `user_groups/${userKey}`));
  const userGroups = userGroupsSnap.val() || {};
  const targetGroup = Object.values(userGroups)[0]?.link;
  if(!targetGroup){
    await update(ref(db, `export_requests/${reqKey}`), { status:"error", error:"No target group" });
    return;
  }
  console.log(`Target group for adding: ${targetGroup}`);

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

      const sourceGroup = await client.getEntity(req.groupLink);
      const targetGroupEntity = await client.getEntity(targetGroup);

      let i = 0;
      for await(const member of client.iterParticipants(sourceGroup)){
        // Stop if request cancelled
        const reqSnap = await get(ref(db, `export_requests/${reqKey}`));
        if(reqSnap.val()?.status !== "pending") {
          console.log("Request cancelled, stopping...");
          return;
        }

        try {
          // Add member to target group
          await client.addParticipant(targetGroupEntity, [member]);
          console.log(`✅ Added ${member.username||member.id} to target group`);

          // Log in exported_members
          await push(ref(db, `exported_members/${userKey}`), {
            id: member.id.toString(),
            username: member.username||null,
            firstName: member.firstName||null,
            lastName: member.lastName||null,
            groupLink: req.groupLink,
            addedTo: targetGroup,
            createdAt: Date.now()
          });

          // Log in app_members for app-wide tracking
          await push(ref(db, `app_members`), {
            id: member.id.toString(),
            username: member.username||null,
            firstName: member.firstName||null,
            lastName: member.lastName||null,
            addedBy: userKey,
            groupLink: targetGroup,
            sourceGroup: req.groupLink,
            createdAt: Date.now()
          });

          i++;
          if(i >= 50) break; // limit per account, configurable
        } catch(e){
          console.error(`Failed to add ${member.username||member.id}: ${e.message}`);
        }
      }

      await update(ref(db, `export_requests/${reqKey}`), { status:"done", processedAt:Date.now() });
      console.log(`✅ Finished adding members to ${targetGroup}`);
      break; // stop after successful account
    } catch(err){
      console.error(`❌ Account ${acc.api_id} failed: ${err.message}`);
      await update(ref(db, `export_requests/${reqKey}`), { status:"error", error:err.message });
    }
  }
});

// ===== Express Server =====
const webApp = express();
const PORT = process.env.PORT || 3000;
webApp.get("/", (req,res)=>res.send("Telegram Add Members Worker PRO+++ Live"));
webApp.listen(PORT, ()=>console.log(`Server running on port ${PORT}`));
