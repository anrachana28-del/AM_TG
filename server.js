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
  projectId: process.env.FIREBASE_PROJECT_ID
};
const appFirebase = initializeApp(firebaseConfig);
const db = getDatabase(appFirebase);

// ===== Telegram Add Member Worker =====
onChildAdded(ref(db, "add_requests"), async (snap) => {
  const req = snap.val();
  if (!req || req.status !== "pending") return;
  const { groupLink, createdBy, members } = req;

  // Load accounts for this user
  const accountsSnap = await get(ref(db, "telegram_accounts"));
  const accounts = Object.values(accountsSnap.val() || {}).filter(a => a.createdBy === createdBy && a.session);
  if (!accounts.length) {
    await update(ref(db, `add_requests/${snap.key}`), { status: "error", error: "No accounts available" });
    return;
  }

  for (const acc of accounts) {
    try {
      const client = new TelegramClient(
        new StringSession(acc.session),
        parseInt(acc.api_id),
        acc.api_hash,
        { connectionRetries: 5 }
      );
      await client.start({ phoneNumber: null, password: null });
      console.log(`Logged in with API_ID ${acc.api_id}`);

      const groupEntity = await client.getEntity(groupLink);

      for (const m of members) {
        try {
          await client.addUserToChannel(groupEntity, m.id);
          // Log added member to Firebase
          await push(ref(db, `added_members/${createdBy}`), {
            ...m,
            groupLink,
            addedBy: acc.api_id,
            createdAt: Date.now()
          });
          console.log(`✅ Added ${m.username || m.id} to ${groupLink}`);
        } catch (e) {
          console.error(`❌ Failed to add ${m.username || m.id}: ${e.message}`);
        }
      }

      await update(ref(db, `add_requests/${snap.key}`), { status: "done", processedAt: Date.now() });
      console.log(`✅ Completed request for ${groupLink}`);
      break; // stop after first working account
    } catch (err) {
      console.error(`❌ Account ${acc.api_id} failed: ${err.message}`);
      continue; // try next account if fails
    }
  }
});

// ===== Express Server for Monitoring =====
const app = express();
const PORT = process.env.PORT || 3000;

// Basic status endpoint
app.get("/", (req, res) => {
  res.send(`<h1>Telegram Add-Member Worker</h1>
    <p>Status: Running ✅</p>
    <p>Check Firebase for live logs and processed requests.</p>`);
});

app.listen(PORT, () => {
  console.log(`🌐 Express server running on port ${PORT}`);
});
