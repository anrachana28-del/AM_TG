import 'dotenv/config';
import express from "express";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, onChildAdded, push, update } from "firebase/database";
import { TelegramClient } from "telegram/index.js";
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
// Listen for any export request added
onChildAdded(ref(db, "export_requests"), async (snapshot) => {
  const reqKey = snapshot.key;
  const req = snapshot.val();
  if (!req || !req.groupLink || !req.username) return;

  console.log(`Processing export request by ${req.username}: ${req.groupLink}`);

  // Load accounts only of this user
  const accountsRef = ref(db, `telegram_accounts/${req.username}`);
  let accountsList = [];
  onValue(accountsRef, (snap) => {
    const data = snap.val();
    accountsList = data ? Object.values(data) : [];
  }, { onlyOnce: true });

  for (let acc of accountsList) {
    try {
      const client = new TelegramClient(
        new StringSession(acc.session),
        parseInt(acc.api_id),
        acc.api_hash,
        { connectionRetries: 5 }
      );

      await client.start({
        phoneNumber: async () => process.env.DEFAULT_PHONE_NUMBER || "+85515318660",
        password: async () => "",
      });

      console.log(`Logged in with API_ID ${acc.api_id}`);

      const groupEntity = await client.getEntity(req.groupLink);
      const participants = await client.getParticipants(groupEntity, { limit: 1000 });

      for (let user of participants) {
        await push(ref(db, `exported_members/${req.username}`), {
          id: user.id.toString(), // avoid BigInt issue
          username: user.username || null,
          first_name: user.firstName || null,
          last_name: user.lastName || null,
          createdAt: Date.now()
        });
      }

      await update(ref(db, `export_requests/${req.username}/${reqKey}`), { status: "done" });
      console.log(`Exported ${participants.length} members for ${req.groupLink}`);
      break; // stop after first success
    } catch (err) {
      console.error(`Failed with account ${acc.api_id}: ${err.message}`);
      await update(ref(db, `export_requests/${req.username}/${reqKey}`), { status: "error", error: err.message });
    }
  }
});

// ===== Minimal Express Server (Keep Live) =====
const webApp = express();
const PORT = process.env.PORT || 3000;
webApp.get("/", (req, res) => res.send("Telegram Note.js Worker Live"));
webApp.listen(PORT, () => console.log(`Live server running on port ${PORT}`));
