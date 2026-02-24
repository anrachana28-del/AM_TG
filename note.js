import 'dotenv/config';
import express from "express";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, onChildAdded, push, update } from "firebase/database";
import { TelegramClient } from "telegram/index.js";
import { StringSession } from "telegram/sessions/index.js";

// Firebase (from Render .env)
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DB_URL,
  projectId: process.env.FIREBASE_PROJECT_ID,
};

const appFB = initializeApp(firebaseConfig);
const db = getDatabase(appFB);

// Load telegram accounts
let accounts = [];
onValue(ref(db, "telegram_accounts"), snap => {
  const data = snap.val();
  accounts = data ? Object.values(data).filter(a =>
    a.api_id && a.api_hash && a.session
  ) : [];
  console.log("Accounts loaded:", accounts.length);
});

// Listen export requests
onChildAdded(ref(db, "export_requests"), async snap => {
  const key = snap.key;
  const req = snap.val();
  if (!req || req.status !== "pending") return;

  for (const acc of accounts) {
    try {
      const client = new TelegramClient(
        new StringSession(acc.session),
        parseInt(acc.api_id),
        acc.api_hash,
        { connectionRetries: 5 }
      );

      await client.start({ phoneNumber: async () => "" });
      console.log("Logged:", acc.api_id);

      const group = await client.getEntity(req.groupLink);
      const users = await client.getParticipants(group, { limit: 1000 });

      for (const u of users) {
        await push(ref(db, "exported_members"), {
          id: u.id,
          username: u.username || null,
          first_name: u.firstName || null,
          last_name: u.lastName || null,
          createdAt: Date.now()
        });
      }

      await update(ref(db, `export_requests/${key}`), { status: "done" });
      console.log("Export done:", users.length);
      break;

    } catch (e) {
      console.error(e.message);
      await update(ref(db, `export_requests/${key}`), {
        status: "error",
        error: e.message
      });
    }
  }
});

// Keep Render live
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (_, res) => res.send("Telegram Worker Live"));
app.listen(PORT, () => console.log("Live on", PORT));
