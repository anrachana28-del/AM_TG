// note.js
import 'dotenv/config';
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, push, update, onChildAdded } from "firebase/database";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

// ===== Fix __dirname in ES module =====
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== Firebase Config =====
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DB_URL,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
};

const appFirebase = initializeApp(firebaseConfig);
const db = getDatabase(appFirebase);
const storage = getStorage(appFirebase);

// ===== Listen Export Requests =====
onChildAdded(ref(db, "export_requests"), async (snapshot) => {

  const reqKey = snapshot.key;
  const req = snapshot.val();
  if (!req || !req.groupLink || !req.createdBy) return;

  const userKey = req.createdBy;
  console.log(`🚀 Processing: ${req.groupLink}`);

  await update(ref(db, `export_requests/${reqKey}`), {
    status: "processing",
    totalExported: 0
  });

  // Load accounts
  const accountsSnap = await get(ref(db, "telegram_accounts"));
  const accounts = Object.values(accountsSnap.val() || {})
    .filter(acc => acc.createdBy === userKey);

  if (!accounts.length) {
    await update(ref(db, `export_requests/${reqKey}`), {
      status: "error",
      error: "No accounts found"
    });
    return;
  }

  let success = false;

  for (const acc of accounts) {
    try {

      const client = new TelegramClient(
        new StringSession(acc.session),
        parseInt(acc.api_id),
        acc.api_hash,
        { connectionRetries: 5 }
      );

      await client.connect();
      console.log(`✅ Logged in API_ID ${acc.api_id}`);

      const group = await client.getEntity(req.groupLink);
      let count = 0;

      for await (const user of client.iterParticipants(group)) {

        let photoURL = null;

        try {
          // Download profile photo
          const buffer = await client.downloadProfilePhoto(user, { isBig: false });

          if (buffer) {
            const filePath = `profile_photos/${user.id}.jpg`;
            const fileRef = storageRef(storage, filePath);

            await uploadBytes(fileRef, buffer, {
              contentType: "image/jpeg"
            });

            photoURL = await getDownloadURL(fileRef);
          }

        } catch (photoErr) {
          console.log(`No photo for ${user.id}`);
        }

        await push(ref(db, `exported_members/${userKey}`), {
          id: user.id.toString(),
          username: user.username || null,
          first_name: user.firstName || null,
          last_name: user.lastName || null,
          profilePhoto: photoURL,
          lastSeen: user.status?.constructor?.name || null,
          groupLink: req.groupLink,
          createdAt: Date.now()
        });

        count++;

        if (count % 50 === 0) {
          await update(ref(db, `export_requests/${reqKey}`), {
            totalExported: count
          });
        }
      }

      await update(ref(db, `export_requests/${reqKey}`), {
        status: "done",
        totalExported: count,
        finishedAt: Date.now()
      });

      console.log(`✅ DONE (${count} members)`);
      success = true;
      break;

    } catch (err) {
      console.log(`❌ Account failed: ${err.message}`);
    }
  }

  if (!success) {
    await update(ref(db, `export_requests/${reqKey}`), {
      status: "error",
      error: "All accounts failed"
    });
  }

});

// ===== Express Keep Alive =====
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => res.send("Telegram Worker Running"));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
