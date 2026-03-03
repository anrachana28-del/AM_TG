// note.js
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
  if (!req || !req.groupLink || !req.createdBy) return;

  const userKey = req.createdBy;
  console.log(`Processing export request by ${userKey}: ${req.groupLink}`);

  // Load all accounts and filter by user
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

      // ===== Chunked export to avoid WRITE_TOO_BIG =====
      const CHUNK_SIZE = 50;
      let batch = [];
      for await (const user of client.iterParticipants(groupEntity)) {

        // Build member object
        const member = {
          id: user.id.toString(),
          username: user.username || null,
          first_name: user.firstName || null,
          last_name: user.lastName || null,
          profilePhoto: user.photo ? `https://t.me/i/userpic/${user.id}_50.jpg` : null,
          lastSeen: user.status ? (user.status.wasOnline || null) : null,
          createdAt: Date.now()
        };

        batch.push(member);

        // Push batch when full
        if (batch.length >= CHUNK_SIZE) {
          await push(ref(db, `exported_members/${userKey}`), batch);
          batch = [];
        }
      }

      // Push remaining members
      if (batch.length) await push(ref(db, `exported_members/${userKey}`), batch);

      // Update request status
      await update(ref(db, `export_requests/${reqKey}`), { status: "done" });
      console.log(`✅ Exported members for ${req.groupLink}`);
      break; // stop after first working account

    } catch (err) {
      console.error(`❌ Failed with account ${acc.api_id}: ${err.message}`);
      await update(ref(db, `export_requests/${reqKey}`), { status: "error", error: err.message });
    }
  }
});

// ===== Express Server to keep worker alive =====
const webApp = express();
const PORT = process.env.PORT || 3000;
webApp.get("/", (req, res) => res.send("Telegram Node.js Worker Live"));
webApp.listen(PORT, () => console.log(`Server running on port ${PORT}`));
