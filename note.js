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
  if (!req || !req.groupLink || !req.createdBy) return;

  const userKey = req.createdBy;
  if(req.status !== "pending") return; // Only start if pending
  console.log(`Processing export request by ${userKey}: ${req.groupLink}`);

  const accountsSnap = await get(ref(db, "telegram_accounts"));
  const allAccounts = accountsSnap.val() || {};
  const accountsList = Object.values(allAccounts).filter(acc => acc.createdBy === userKey);

  if (!accountsList.length) {
    console.log(`❌ No accounts found for user ${userKey}`);
    await update(ref(db, `export_requests/${reqKey}`), { status: "error", error: "No accounts" });
    return;
  }

  for (const acc of accountsList) {
    try {
      const client = new TelegramClient(
        new StringSession(acc.session),
        parseInt(acc.api_id),
        acc.api_hash,
        { connectionRetries: 5 }
      );
      await client.start({ phoneNumber: null, password: null });
      console.log(`Logged in with API_ID ${acc.api_id}`);

      const groupEntity = await client.getEntity(req.groupLink);

      // Fetch participants
      for await (const user of client.iterParticipants(groupEntity)) {
        let lastSeen = null;
        try {
          if(user.status){
            if(user.status.constructor.name === "UserStatusOnline") lastSeen = Date.now();
            else if(user.status.constructor.name === "UserStatusOffline") lastSeen = user.status.was_online * 1000;
          }
        } catch(e){ lastSeen = null; }

        let profilePhoto = null;
        try {
          if(user.photo){
            profilePhoto = await client.downloadProfilePhoto(user, {download: false}); // get URL
          }
        } catch(e){ profilePhoto = null; }

        await push(ref(db, `exported_members/${userKey}`), {
          id: user.id.toString(),
          username: user.username || null,
          firstName: user.firstName || null,
          lastName: user.lastName || null,
          profilePhoto,
          lastSeen,
          createdAt: Date.now()
        });
      }

      await update(ref(db, `export_requests/${reqKey}`), { status: "done" });
      console.log(`✅ Exported members for ${req.groupLink}`);
      break; // Stop after first working account
    } catch (err) {
      console.error(`❌ Failed with account ${acc.api_id}: ${err.message}`);
      await update(ref(db, `export_requests/${reqKey}`), { status: "error", error: err.message });
    }
  }
});

console.log("Telegram Worker running...");
