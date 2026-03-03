import 'dotenv/config';
import express from "express";
import { initializeApp } from "firebase/app";
import { 
  getDatabase, 
  ref, 
  get, 
  push, 
  update, 
  query, 
  orderByChild, 
  equalTo 
} from "firebase/database";

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { Api } from "telegram";

// ===== Firebase Config =====
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DB_URL,
  projectId: process.env.FIREBASE_PROJECT_ID,
};

const appFirebase = initializeApp(firebaseConfig);
const db = getDatabase(appFirebase);

// ===== MAIN EXPORT CHECKER (NO AUTO EXPORT) =====
let isRunning = false;

async function checkPendingExports() {

  if (isRunning) return;
  isRunning = true;

  try {

    const q = query(
      ref(db, "export_requests"),
      orderByChild("status"),
      equalTo("pending")
    );

    const snap = await get(q);

    if (!snap.exists()) {
      isRunning = false;
      return;
    }

    for (const [reqKey, req] of Object.entries(snap.val())) {

      console.log("🚀 Processing:", req.groupLink);

      await update(ref(db, `export_requests/${reqKey}`), {
        status: "processing",
        startedAt: Date.now()
      });

      await runExport(req, reqKey);
    }

  } catch (err) {
    console.error("Export Check Error:", err.message);
  }

  isRunning = false;
}

// Check every 5 seconds
setInterval(checkPendingExports, 5000);

// ===== EXPORT FUNCTION =====
async function runExport(req, reqKey) {

  try {

    const accountsSnap = await get(ref(db, "telegram_accounts"));
    const allAccounts = accountsSnap.val() || {};

    const accountsList = Object.values(allAccounts)
      .filter(acc => acc.createdBy === req.createdBy);

    if (!accountsList.length)
      throw new Error("No Telegram accounts found");

    const acc = accountsList[0];

    const client = new TelegramClient(
      new StringSession(acc.session),
      parseInt(acc.api_id),
      acc.api_hash,
      { connectionRetries: 5 }
    );

    await client.connect();
    console.log("✅ Logged in:", acc.api_id);

    const group = await client.getEntity(req.groupLink);

    let count = 0;

    for await (const user of client.iterParticipants(group)) {

      // ===== LAST SEEN =====
      let lastSeen = null;

      if (user.status instanceof Api.UserStatusOnline) {
        lastSeen = Date.now();
      }
      else if (user.status instanceof Api.UserStatusOffline) {
        lastSeen = user.status.wasOnline * 1000;
      }

      // ===== PROFILE PHOTO =====
      let profilePhoto = null;

      try {
        const photoBuffer = await client.downloadProfilePhoto(user, {
          file: "buffer"
        });

        if (photoBuffer) {
          profilePhoto =
            `data:image/jpeg;base64,${photoBuffer.toString("base64")}`;
        }
      } catch {}

      // ===== SAVE MEMBER =====
      await push(ref(db, `exported_members/${req.createdBy}`), {
        id: user.id.toString(),
        username: user.username || null,
        firstName: user.firstName || null,
        lastName: user.lastName || null,
        lastSeen,
        profilePhoto,
        groupLink: req.groupLink,
        createdAt: Date.now()
      });

      count++;
    }

    await client.disconnect();

    await update(ref(db, `export_requests/${reqKey}`), {
      status: "done",
      membersCount: count,
      finishedAt: Date.now()
    });

    console.log("🎉 Export Done:", count);

  } catch (err) {

    await update(ref(db, `export_requests/${reqKey}`), {
      status: "error",
      error: err.message
    });

    console.error("❌ Export Failed:", err.message);
  }
}

// ===== Express Keep Alive =====
const webApp = express();
const PORT = process.env.PORT || 3000;

webApp.get("/", (req, res) =>
  res.send("🔥 Telegram Worker PRO+++ Running")
);

webApp.listen(PORT, () =>
  console.log(`Server running on port ${PORT}`)
);
