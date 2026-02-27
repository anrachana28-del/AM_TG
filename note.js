import 'dotenv/config';
import express from "express";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, onChildAdded, push, update, onValue } from "firebase/database";
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
onChildAdded(ref(db, "export_requests"), async (snapshot) => {
  const reqKey = snapshot.key;
  const req = snapshot.val();
  if (!req || !req.groupLink || !req.accounts || !req.createdBy) return;

  console.log(`Processing export request by ${req.createdBy}: ${req.groupLink}`);

  // Load all accounts of this user
  const accountsRef = ref(db, `telegram_accounts`);
  let accountsList = [];
  await new Promise((res) =>
    onValue(accountsRef, (snap) => {
      const data = snap.val();
      if (data) {
        accountsList = Object.values(data).filter(a => a.createdBy === req.createdBy && req.accounts.includes(a.key || a.api_id));
      }
      res();
    }, { onlyOnce: true })
  );

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
      const participants = await client.getParticipants(groupEntity, { limit: 10000 }); // adjust limit as needed

      for (let user of participants) {
        let profilePhoto = null;
        try {
          const photo = await client.downloadProfilePhoto(user, { file: "blob" });
          if (photo) profilePhoto = `data:image/jpeg;base64,${Buffer.from(photo).toString("base64")}`;
        } catch(e){ profilePhoto = null; }

        await push(ref(db, `exported_members/${req.createdBy}`), {
          id: user.id.toString(),
          username: user.username || null,
          firstName: user.firstName || null,
          lastName: user.lastName || null,
          profilePhoto,
          createdAt: Date.now()
        });
      }

      // Update request status
      await update(ref(db, `export_requests/${req.createdBy}/${reqKey}`), { status: "done" });
      console.log(`Exported ${participants.length} members for ${req.groupLink}`);
      break; // stop after first success
    } catch (err) {
      console.error(`Failed with account ${acc.api_id}: ${err.message}`);
      await update(ref(db, `export_requests/${req.createdBy}/${reqKey}`), { status: "error", error: err.message });
    }
  }
});

// ===== Minimal Express Server (Keep Live) =====
const webApp = express();
const PORT = process.env.PORT || 3000;
webApp.get("/", (req, res) => res.send("Telegram Note.js Worker PRO+++ Live"));
webApp.listen(PORT, () => console.log(`Live server running on port ${PORT}`));
