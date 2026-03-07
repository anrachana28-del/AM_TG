import 'dotenv/config';
import express from "express";
import cors from "cors";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, onChildAdded, set, get, push, remove } from "firebase/database";

// ===== Firebase config =====
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DB_URL,
  projectId: process.env.FIREBASE_PROJECT_ID,
};

const appFirebase = initializeApp(firebaseConfig);
const db = getDatabase(appFirebase);

// ===== Express server =====
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: "*" })); // allow all origins (adjust for production)
app.use(express.json());

// ===== API: Create add-request =====
app.post("/add-request", async (req, res) => {
  const { username, targetGroup, members } = req.body;
  if (!username || !targetGroup || !members || !members.length)
    return res.status(400).json({ error: "Missing username, targetGroup or members" });

  try {
    const addRef = ref(db, "add_requests");
    for (const member of members) {
      const key = push(addRef).key;
      await set(ref(db, `add_requests/${key}`), {
        createdBy: username,
        targetGroup,
        memberUsername: member.username || member.user_id,
        status: "pending",
        createdAt: Date.now()
      });

      // Optional: Remove from exported_members once added to request queue
      const memSnap = await get(ref(db, `exported_members/${username}`));
      if (memSnap.exists()) {
        memSnap.forEach(child => {
          const val = child.val();
          if ((val.username && val.username === member.username) || val.user_id === member.user_id) {
            remove(ref(db, `exported_members/${username}/${child.key}`));
          }
        });
      }
    }

    res.json({ status: "success", message: `${members.length} members added to request queue` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ===== API: list app members =====
app.get("/app-members/:username", async (req, res) => {
  const username = req.params.username;
  if (!username) return res.status(400).json({ error: "Missing username" });

  try {
    const memSnap = await get(ref(db, `app_members/${username}`));
    const members = memSnap.exists() ? Object.values(memSnap.val()) : [];
    res.json({ status: "success", members });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== Root =====
app.get("/", (req, res) => {
  res.send("Telegram Add Members Server PRO+++ Live");
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
