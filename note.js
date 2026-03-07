import 'dotenv/config';
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

// ===== Add Members Listener =====
onChildAdded(ref(db, "add_members_requests"), async (snapshot) => {
  const reqKey = snapshot.key;
  const req = snapshot.val();
  if (!req || req.status !== "pending") return;

  const members = req.members || [];
  if (!members.length) {
    await update(ref(db, `add_members_requests/${reqKey}`), { status: "error", error: "No members provided" });
    return;
  }

  // Load accounts for the user
  const accountsSnap = await get(ref(db, "telegram_accounts"));
  const allAccounts = accountsSnap.val() || {};
  const accountsList = Object.values(allAccounts).filter(acc => acc.createdBy === req.createdBy);
  if (!accountsList.length) {
    await update(ref(db, `add_members_requests/${reqKey}`), { status: "error", error: "No Telegram accounts available" });
    return;
  }

  let accountIndex = 0;

  for (const member of members) {
    try {
      const acc = accountsList[accountIndex % accountsList.length]; // rotate accounts
      accountIndex++;

      const client = new TelegramClient(
        new StringSession(acc.session),
        parseInt(acc.api_id),
        acc.api_hash,
        { connectionRetries: 5 }
      );
      await client.start({ phoneNumber: null, password: null });

      const targetEntity = await client.getEntity(req.targetGroup);
      const userEntity = await client.getEntity(member); // username or user_id

      // ⚡ Use appropriate method for channels/supergroups
      if (typeof client.addChatUser === "function") {
        await client.addChatUser(targetEntity, userEntity, 0); // for basic chats
      } else if (typeof client.addUserToChannel === "function") {
        await client.addUserToChannel(targetEntity, userEntity); // supergroup/channel
      } else {
        throw new Error("No valid method to add member found in TelegramClient");
      }

      console.log(`✅ Added ${member} using account ${acc.api_id}`);

      // Log to Firebase
      await push(ref(db, `add_members_requests/${reqKey}/logs`), {
        member,
        status: "added",
        timestamp: Date.now(),
        accountUsed: acc.api_id
      });

      // 30 seconds delay
      await new Promise(resolve => setTimeout(resolve, 30 * 1000));

    } catch (err) {
      console.error(`❌ Failed to add ${member}: ${err.message}`);
      await push(ref(db, `add_members_requests/${reqKey}/logs`), {
        member,
        status: "error",
        error: err.message,
        timestamp: Date.now()
      });
    }
  }

  await update(ref(db, `add_members_requests/${reqKey}`), { status: "done", processedAt: Date.now() });
  console.log(`✅ Finished Add Members request ${reqKey}`);
});
