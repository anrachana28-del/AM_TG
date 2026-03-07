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

const PER_ACCOUNT_LIMIT = 45;

const sleep = ms => new Promise(r => setTimeout(r, ms));

console.log("🚀 Telegram Add Worker Started");

onChildAdded(ref(db,"add_requests"), async snap=>{
  const req = snap.val();
  if(!req || req.status !== "pending") return;

  const { groupLink, createdBy } = req;

  console.log(`📌 New Request → ${groupLink}`);

  // load accounts
  const accSnap = await get(ref(db,"telegram_accounts"));
  const accounts = Object.values(accSnap.val()||{})
    .filter(a=>a.createdBy===createdBy && a.session);

  if(!accounts.length){
    await update(ref(db,`add_requests/${snap.key}`),{status:"error"});
    return;
  }

  // load members
  const memSnap = await get(ref(db,`exported_members/${createdBy}`));
  const members = Object.values(memSnap.val()||{});

  const total = members.length;

  await update(ref(db,`add_requests/${snap.key}`),{
    total,
    progress:0,
    status:"running"
  });

  let progress = 0;
  let memberIndex = 0;

  for(const acc of accounts){

    const client = new TelegramClient(
      new StringSession(acc.session),
      parseInt(acc.api_id),
      acc.api_hash,
      {connectionRetries:5}
    );

    await client.start({phoneNumber:null,password:null});

    console.log(`✅ Logged account ${acc.api_id}`);

    const group = await client.getEntity(groupLink);

    let used = 0;

    while(used < PER_ACCOUNT_LIMIT && memberIndex < members.length){

      const m = members[memberIndex];

      try{

        await client.addUserToChannel(group,m.id);

        await push(ref(db,`added_members/${createdBy}`),{
          ...m,
          groupLink,
          addedAt:Date.now()
        });

        progress++;
        used++;
        memberIndex++;

        console.log(`➕ ${m.username||m.id}`);

        await update(ref(db,`add_requests/${snap.key}`),{
          progress
        });

        await sleep(3000);

      }catch(err){

        if(err.message.includes("FLOOD_WAIT")){

          const wait = parseInt(err.message.match(/\d+/)[0]) * 1000;

          console.log(`⏳ Flood wait ${wait/1000}s`);

          await sleep(wait);

        }else{

          console.log(`⚠️ Failed ${m.username}`);

          memberIndex++;
        }

      }

    }

    console.log(`🔄 Switching account`);

    if(memberIndex >= members.length) break;

  }

  await update(ref(db,`add_requests/${snap.key}`),{
    status:"done",
    progress:total
  });

  console.log("🎯 All members processed");

});
