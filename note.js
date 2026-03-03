import 'dotenv/config';
import express from "express";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, push, update, remove, onValue } from "firebase/database";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

// Firebase
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DB_URL,
  projectId: process.env.FIREBASE_PROJECT_ID,
};

const appFirebase = initializeApp(firebaseConfig);
const db = getDatabase(appFirebase);

// Listen for manual processing only
onValue(ref(db, "export_requests"), async (snapshot) => {
  const requests = snapshot.val();
  if (!requests) return;

  for (const reqKey in requests) {
    const req = requests[reqKey];

    if (req.status !== "processing") continue;

    console.log(`🚀 Start Export: ${req.groupLink}`);

    try {
      const accountsSnap = await get(ref(db, "telegram_accounts"));
      const accounts = Object.values(accountsSnap.val() || {})
        .filter(acc => acc.createdBy === req.createdBy);

      if (!accounts.length) throw new Error("No accounts");

      const acc = accounts[0];

      const client = new TelegramClient(
        new StringSession(acc.session),
        parseInt(acc.api_id),
        acc.api_hash,
        { connectionRetries: 5 }
      );

      await client.connect();

      const group = await client.getEntity(req.groupLink);

      let count = 0;

      for await (const user of client.iterParticipants(group)) {

        // 🔴 Stop if cancelled
        const liveReq = (await get(ref(db, `export_requests/${reqKey}`))).val();
        if (liveReq.status === "cancelled") {
          console.log("🛑 Export Cancelled");
          return;
        }

        await push(ref(db, `exported_members/${reqKey}`), {
          id: user.id.toString(),
          username: user.username || null,
          first_name: user.firstName || null,
          last_name: user.lastName || null,
          createdAt: Date.now()
        });

        count++;

        // update progress
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

      console.log(`✅ Done (${count} members)`);

    } catch (err) {
      await update(ref(db, `export_requests/${reqKey}`), {
        status: "error",
        error: err.message
      });
      console.log("❌ Error:", err.message);
    }
  }
});

// Keep Alive Server
const app = express();
app.get("/", (req, res) => res.send("Manual Telegram Export Worker Running"));
app.listen(process.env.PORT || 3000);
