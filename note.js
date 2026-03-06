import 'dotenv/config';
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

  // dynamically get the user who created the request
  const userKey = req.createdBy;
  console.log(`Processing export request by ${userKey}: ${req.groupLink}`);

  // Get all Telegram accounts for this user
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
        // Check if request was cancelled
        const reqSnap = await get(ref(db, `export_requests/${reqKey}`));
        if(reqSnap.val()?.status !== "pending") {
          console.log("Export cancelled, stopping...");
          return;
        }

        await push(ref(db, `exported_members/${userKey}`), {
          id: user.id.toString(),
          username: user.username || null,
          firstName: user.firstName || null,
          lastName: user.lastName || null,
          groupLink: req.groupLink,
          createdAt: Date.now()
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

console.log("Telegram Export Worker PRO+++ Running...");