// note.js
import 'dotenv/config';
import express from "express";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, push, update, onChildAdded } from "firebase/database";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { downloadProfilePhoto } from "telegram/utils"; // optional

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
  console.log(`🚀 Processing export request by ${userKey}: ${req.groupLink}`);

  // Mark as processing
  await update(ref(db, `export_requests/${reqKey}`), { status: "processing" });

  // Load accounts
  const accountsSnap = await get(ref(db, "telegram_accounts"));
  const allAccounts = accountsSnap.val() || {};
  const accountsList = Object.values(allAccounts).filter(acc => acc.createdBy === userKey);

  if (!accountsList.length) {
    console.log(`❌ No accounts for user ${userKey}`);
    await update(ref(db, `export_requests/${reqKey}`), { status: "error", error: "No accounts" });
    return;
  }

  let success = false;

  for (const acc of accountsList) {
    try {
      const client = new TelegramClient(
        new StringSession(acc.session),
        parseInt(acc.api_id),
        acc.api_hash,
        { connectionRetries: 5 }
      );

      await client.start({ phoneNumber: null, password: null });
      console.log(`✅ Logged in with API_ID ${acc.api_id}`);

      const groupEntity = await client.getEntity(req.groupLink);
      let count = 0;

      for await (const user of client.iterParticipants(groupEntity)) {
        try {
          const profilePhotoUrl = user.photo ? await downloadProfilePhoto(client, user) : null;
          const lastSeenStatus = user.status ? user.status.constructor.name : null;

          await push(ref(db, `exported_members/${userKey}`), {
            id: user.id.toString(),
            username: user.username || null,
            first_name: user.firstName || null,
            last_name: user.lastName || null,
            profilePhoto: profilePhotoUrl,
            lastSeen: lastSeenStatus,
            createdAt: Date.now(),
            groupLink: req.groupLink
          });

          count++;
          // Update progress every 50 users
          if (count % 50 === 0) {
            await update(ref(db, `export_requests/${reqKey}`), { totalExported: count });
          }
        } catch (errUser) {
          console.log(`⚠️ Failed to push user ${user.id}: ${errUser.message}`);
        }
      }

      await update(ref(db, `export_requests/${reqKey}`), {
        status: "done",
        totalExported: count,
        finishedAt: Date.now()
      });
      console.log(`✅ Done exporting ${count} members for ${req.groupLink}`);
      success = true;
      break; // stop after first successful account

    } catch (err) {
      console.error(`❌ Failed with account ${acc.api_id}: ${err.message}`);
      await update(ref(db, `export_requests/${reqKey}`), { status: "error", error: err.message });
    }
  }

  if (!success) {
    console.log(`❌ All accounts failed for request ${req.groupLink}`);
    await update(ref(db, `export_requests/${reqKey}`), { status: "error", error: "All accounts failed" });
  }
});

// ===== Express Server =====
const webApp = express();
const PORT = process.env.PORT || 3000;
webApp.get("/", (req, res) => res.send("Telegram Node.js Worker Live"));
webApp.listen(PORT, () => console.log(`Server running on port ${PORT}`));
