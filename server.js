import 'dotenv/config';
import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, push, update, onChildAdded } from "firebase/database";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DB_URL,
  projectId: process.env.FIREBASE_PROJECT_ID
};
const appFirebase = initializeApp(firebaseConfig);
const db = getDatabase(appFirebase);

console.log("Telegram Add Worker Started ✅");

// Listen for Add Requests
onChildAdded(ref(db,"add_requests"), async snap=>{
  const req = snap.val();
  if(!req || req.status!=="pending") return;
  const { groupLink, createdBy } = req;

  // Load accounts
  const accountsSnap = await get(ref(db,"telegram_accounts"));
  const accounts = Object.values(accountsSnap.val()||{}).filter(a=>a.createdBy===createdBy && a.session);
  if(!accounts.length){
    await update(ref(db, `add_requests/${snap.key}`), {status:"error", error:"No accounts"});
    return;
  }

  const acc = accounts[0];
  const client = new TelegramClient(new StringSession(acc.session), parseInt(acc.api_id), acc.api_hash, {connectionRetries:5});
  await client.start({phoneNumber:null,password:null});

  const group = await client.getEntity(groupLink);

  // Add members
  const membersSnap = await get(ref(db,`exported_members/${createdBy}`));
  const members = Object.values(membersSnap.val()||{});

  for(const m of members){
    try{
      await client.addUserToChannel(group, m.id);
      await push(ref(db, `added_members/${createdBy}`), {...m, groupLink, createdAt:Date.now()});
      console.log("Added", m.username || m.id);
    }catch(e){ console.error("Failed", m.username, e.message);}
  }

  await update(ref(db, `add_requests/${snap.key}`), {status:"done", processedAt:Date.now()});
  console.log(`✅ Request done: ${groupLink}`);
});
