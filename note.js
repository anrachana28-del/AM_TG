// worker.js
import { initializeApp } from "firebase/app";
import { getDatabase, ref, push, onValue, set } from "firebase/database";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import input from "input";

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyCpmV3xv-HIxWDm8vgNoNtLHAUpyBcFHTI",
  authDomain: "tool-74d29.firebaseapp.com",
  databaseURL: "https://tool-74d29-default-rtdb.firebaseio.com",
  projectId: "tool-74d29"
};
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Load accounts from Firebase
const accountsRef = ref(db, "telegram_accounts");
let accounts = [];
onValue(accountsRef, snapshot => {
  accounts = [];
  snapshot.forEach(snap => accounts.push({...snap.val(), enabled: true}));
});

// Function: add member
async function addMember(account, member, targetGroup) {
  try {
    const client = new TelegramClient(
      new StringSession(account.session),
      account.api_id,
      account.api_hash,
      { connectionRetries: 5 }
    );
    await client.start({
      phoneNumber: async () => account.phone,
      password: async () => await input.text("2FA code? "),
      phoneCode: async () => await input.text("Code? ")
    });

    // Join group if not joined
    // ... your join logic here ...

    // Add member (example using username)
    // ... your add logic here ...

    // Push success to Firebase
    await push(ref(db, "add_members_requests"), {
      createdBy: "worker",
      members: [{username: member.username, status: "done", processedAt: Date.now(), targetGroup}],
      targetGroup,
      createdAt: Date.now()
    });
  } catch (err) {
    await push(ref(db, "add_members_requests"), {
      createdBy: "worker",
      members: [{username: member.username, status: "fail", processedAt: Date.now(), targetGroup}],
      targetGroup,
      createdAt: Date.now(),
      error: err.message
    });
  }
}

// Rotate accounts, handle flood wait, loop members
async function startAdding(members, targetGroup) {
  let idx = 0;
  for (const m of members) {
    const account = accounts[idx % accounts.length];
    if (!account.enabled) continue;
    await addMember(account, m, targetGroup);

    // delay between adds
    await new Promise(r => setTimeout(r, 30000)); // 30s
    idx++;
  }
}
