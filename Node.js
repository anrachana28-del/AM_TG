import { initializeApp } from "firebase/app";
import { getDatabase, ref, onChildAdded, push, update } from "firebase/database";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import input from "input"; // npm i input

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyAuPx4zukNE-TnBClJbTocOwem0twM1KU0",
  authDomain: "tool-add.firebaseapp.com",
  databaseURL: "https://tool-add-default-rtdb.firebaseio.com",
  projectId: "tool-add",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Fetch Telegram accounts
const accountsRef = ref(db, "telegram_accounts");
let accountsList = [];
import { onValue } from "firebase/database";
onValue(accountsRef, (snapshot) => {
  const data = snapshot.val();
  accountsList = data ? Object.values(data) : [];
  console.log(`Loaded ${accountsList.length} Telegram accounts`);
});

// Listen export requests
const requestsRef = ref(db, "export_requests");
onChildAdded(requestsRef, async (snapshot) => {
  const reqKey = snapshot.key;
  const req = snapshot.val();
  if (!req || !req.groupLink) return;

  console.log(`Processing export request: ${req.groupLink}`);

  for (let acc of accountsList) {
    try {
      const client = new TelegramClient(new StringSession(acc.session), parseInt(acc.api_id), acc.api_hash, { connectionRetries: 5 });
      await client.start({
        phoneNumber: async () => "+000000000",
        password: async () => "",
      });
      console.log(`Logged in with API_ID ${acc.api_id}`);

      // Export members
      const groupEntity = await client.getEntity(req.groupLink);
      const participants = await client.getParticipants(groupEntity, { limit: 1000 });

      for (let user of participants) {
        await push(ref(db, "exported_members"), {
          id: user.id,
          username: user.username || null,
          first_name: user.firstName || null,
          last_name: user.lastName || null,
          createdAt: Date.now()
        });
      }

      await update(ref(db, `export_requests/${reqKey}`), { status: "done" });
      console.log(`Exported ${participants.length} members for ${req.groupLink}`);
      break; // stop after first successful account
    } catch (err) {
      console.error(`Failed with account ${acc.api_id}: ${err.message}`);
      await update(ref(db, `export_requests/${reqKey}`), { status: "error", error: err.message });
    }
  }
});