import 'dotenv/config';
import express from "express";
import { initializeApp } from "firebase/app";
import {
  getDatabase,
  ref,
  get,
  push,
  update,
  onChildAdded,
  remove
} from "firebase/database";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";


// =============================
// FIREBASE CONFIG
// =============================

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DB_URL,
  projectId: process.env.FIREBASE_PROJECT_ID,
};

const appFirebase = initializeApp(firebaseConfig);
const db = getDatabase(appFirebase);


// =============================
// EXPORT LISTENER
// =============================

onChildAdded(ref(db, "export_requests"), async (snapshot) => {

  const reqKey = snapshot.key;
  const req = snapshot.val();

  if (!req || !req.groupLink || !req.createdBy) return;
  if (req.status && req.status !== "pending") return;

  console.log("🚀 New export request:", req.groupLink);

  await update(ref(db, `export_requests/${reqKey}`), {
    status: "processing",
    startedAt: Date.now()
  });

  try {

    const accountsSnap = await get(ref(db, "telegram_accounts"));
    const accounts = accountsSnap.val() || {};

    const userAccounts = Object.values(accounts).filter(
      acc => acc.createdBy === req.createdBy
    );

    if (!userAccounts.length) {
      throw new Error("No Telegram accounts found");
    }

    let exportedCount = 0;
    let success = false;

    for (const acc of userAccounts) {

      try {

        const client = new TelegramClient(
          new StringSession(acc.session),
          parseInt(acc.api_id),
          acc.api_hash,
          { connectionRetries: 5 }
        );

        await client.connect();
        console.log("✅ Connected with account:", acc.api_id);

        const group = await client.getEntity(req.groupLink);

        for await (const user of client.iterParticipants(group)) {

          await push(ref(db, `exported_members/${req.createdBy}`), {
            id: user.id.toString(),
            username: user.username || null,
            firstName: user.firstName || null,
            lastName: user.lastName || null,
            groupLink: req.groupLink,
            createdAt: Date.now()
          });

          exportedCount++;
          await new Promise(r => setTimeout(r, 300));
        }

        await client.disconnect();
        success = true;
        break;

      } catch (accErr) {
        console.log("❌ Account failed:", accErr.message);
      }
    }

    if (!success) {
      throw new Error("All accounts failed");
    }

    await update(ref(db, `export_status/${req.createdBy}`), {
      total: exportedCount,
      status: "done",
      finishedAt: Date.now()
    });

    await update(ref(db, `export_requests/${reqKey}`), {
      status: "done",
      processedAt: Date.now()
    });

    console.log("🎉 Export completed");

  } catch (err) {

    console.error("Export error:", err.message);

    await update(ref(db, `export_requests/${reqKey}`), {
      status: "error",
      error: err.message
    });
  }
});


// =============================
// AUTO DELETE AFTER 30 MINUTES
// =============================

const THIRTY_MIN = 30 * 60 * 1000;

async function autoDeleteExpired() {

  try {

    const snap = await get(ref(db, "export_requests"));
    if (!snap.exists()) return;

    const now = Date.now();

    for (const [key, req] of Object.entries(snap.val())) {

      if (!req.createdAt || !req.createdBy) continue;

      const expired = now - req.createdAt > THIRTY_MIN;

      if (expired) {

        console.log("🗑 Deleting expired request:", key);

        // Delete export request
        await remove(ref(db, `export_requests/${key}`));

        // Delete only members from that group
        const membersSnap = await get(
          ref(db, `exported_members/${req.createdBy}`)
        );

        if (membersSnap.exists()) {

          for (const [mKey, member] of Object.entries(membersSnap.val())) {

            if (member.groupLink === req.groupLink) {
              await remove(
                ref(db, `exported_members/${req.createdBy}/${mKey}`)
              );
            }
          }
        }

        // Delete export status
        await remove(ref(db, `export_status/${req.createdBy}`));
      }
    }

  } catch (err) {
    console.error("Auto delete error:", err.message);
  }
}

// Run every 5 minutes
setInterval(autoDeleteExpired, 5 * 60 * 1000);


// =============================
// KEEP ALIVE SERVER
// =============================

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Worker running 🚀");
});

app.listen(PORT, () =>
  console.log("🌐 Server started on port", PORT)
);
