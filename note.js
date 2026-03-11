import 'dotenv/config';
import { initializeApp } from "firebase/app";
import { getDatabase, ref, onChildAdded, push, update, get } from "firebase/database";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

// ===== Firebase =====
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DB_URL,
  projectId: process.env.FIREBASE_PROJECT_ID
};
const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ===== EXPORT MEMBERS WORKER =====
onChildAdded(ref(db, "export_requests"), async snapshot => {
  const reqKey = snapshot.key;
  const req = snapshot.val();
  if (!req || req.status !== "pending") return;

  const { groupLink, createdBy } = req;
  console.log(`🚀 Export Request from ${createdBy} → ${groupLink}`);

  const accountsSnap = await get(ref(db, "telegram_accounts"));
  const accounts = Object.values(accountsSnap.val() || {}).filter(a => a.createdBy === createdBy && a.session);
  if (!accounts.length) {
    await update(ref(db, `export_requests/${reqKey}`), { status: "error", error: "No accounts available" });
    return;
  }

  for (const acc of accounts) {
    try {
      const client = new TelegramClient(new StringSession(acc.session), parseInt(acc.api_id), acc.api_hash, { connectionRetries: 5 });
      await client.start({ phoneNumber: null, password: null });
      console.log(`🔑 Logged with API_ID ${acc.api_id}`);

      const group = await client.getEntity(groupLink);
      for await (const user of client.iterParticipants(group)) {
        const reqCheck = await get(ref(db, `export_requests/${reqKey}`));
        if (reqCheck.val()?.status !== "pending") {
          console.log("🛑 Export cancelled");
          return;
        }

        // profile photo
        let profilePhoto = "https://via.placeholder.com/100?text=No+Photo";
        try {
          const photoBlob = await client.downloadProfilePhoto(user, { file: "blob" });
          if (photoBlob) profilePhoto = `data:image/jpeg;base64,${Buffer.from(photoBlob).toString("base64")}`;
        } catch (e) {}

        if (!user.accessHash) continue; // skip invalid
        await push(ref(db, `exported_members/${createdBy}`), {
          id: user.id.toString(),
          accessHash: user.accessHash.toString(),
          username: user.username || null,
          firstName: user.firstName || null,
          lastName: user.lastName || null,
          profilePhoto,
          groupLink,
          createdAt: Date.now()
        });
        await sleep(500); // small delay
      }

      await update(ref(db, `export_requests/${reqKey}`), { status: "done", processedAt: Date.now() });
      console.log(`✅ Export Completed: ${groupLink}`);
      break;

    } catch (err) {
      console.log(`❌ Account ${acc.api_id} failed: ${err.message}`);
      await update(ref(db, `export_requests/${reqKey}`), { status: "error", error: err.message });
    }
  }
});

// ===== ADD MEMBERS WORKER =====
onChildAdded(ref(db,"add_members_requests"), async snapshot=>{
  const reqKey = snapshot.key;
  const req = snapshot.val();
  if(!req || req.status!=="pending") return;

  const { targetGroup, members, createdBy } = req;
  const accountsSnap = await get(ref(db,"telegram_accounts"));
  const accounts = Object.values(accountsSnap.val()||{}).filter(a=>a.createdBy===createdBy && a.session);
  if(!accounts.length){ await update(ref(db,`add_members_requests/${reqKey}`),{status:"error",error:"No accounts"}); return; }

  let currentIndex = 0;

  for(const acc of accounts){
    try{
      const client = new TelegramClient(new StringSession(acc.session), parseInt(acc.api_id), acc.api_hash,{connectionRetries:5});
      await client.start({phoneNumber:null,password:null});
      console.log(`🔑 Logged with API_ID ${acc.api_id}`);

      const group = await client.getEntity(targetGroup);

      // check admin permission
      const fullInfo = await client.invoke(new Api.channels.GetFullChannel({channel:group}));
      if(!fullInfo.fullChat.adminRights){ throw new Error("Account not admin in target group"); }

      for(const m of members){
        if(!m.accessHash) continue;

        let success=false;
        for(let i=0;i<accounts.length;i++){
          currentIndex = (currentIndex+i)%accounts.length;
          const accountToUse = accounts[currentIndex];
          try{
            const user = new Api.InputUser({userId:BigInt(m.id), accessHash:BigInt(m.accessHash)});
            await client.invoke(new Api.channels.InviteToChannel({channel:group,users:[user]}));

            await push(ref(db,`added_members/${createdBy}`),{username:m.username||null,id:m.id,group:targetGroup,addedBy:accountToUse.api_id,createdAt:Date.now()});
            console.log(`✅ Added ${m.username||m.id} by ${accountToUse.api_id}`);
            success=true;
            await sleep(10000); // delay 10s per user
            break;
          }catch(e){
            console.log(`❌ Failed ${m.username||m.id} → ${e.message}`);
            await push(ref(db,`added_members_error/${createdBy}`),{username:m.username||null,id:m.id,group:targetGroup,error:e.message,addedBy:accountToUse.api_id,createdAt:Date.now()});
            if(e.message.includes("FLOOD_WAIT")) break;
          }
        }
        if(!success) console.log(`⚠ Could not add ${m.username||m.id}`);
      }

      await update(ref(db,`add_members_requests/${reqKey}`),{status:"done",processedAt:Date.now()});
      break;

    }catch(e){ console.log(`Account ${acc.api_id} failed: ${e.message}`); continue; }
  }
});
