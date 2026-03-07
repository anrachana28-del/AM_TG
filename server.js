import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, push, set, remove } from "firebase/database";

const app = express();
app.use(cors());
app.use(bodyParser.json());

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DB_URL,
  projectId: process.env.FIREBASE_PROJECT_ID
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);

// Get exported members
app.get("/fetch-members/:username", async (req, res) => {
  const username = req.params.username;
  try {
    const snap = await get(ref(db, `exported_members/${username}`));
    const members = snap.exists() ? Object.values(snap.val()) : [];
    res.json({ members });
  } catch (err) {
    res.json({ members: [], error: err.message });
  }
});

// Get user groups
app.get("/fetch-groups/:username", async (req, res) => {
  const username = req.params.username;
  try {
    const snap = await get(ref(db, `user_groups/${username}`));
    const groups = [];
    if (snap.exists()) {
      snap.forEach(child => {
        groups.push({ key: child.key, link: child.val().link });
      });
    }
    res.json({ groups });
  } catch (err) {
    res.json({ groups: [], error: err.message });
  }
});

// Add members to selected group
app.post("/add-request", async (req, res) => {
  const { username, targetGroup, members } = req.body;
  if (!username || !targetGroup || !members) return res.json({ status:"error", error:"Missing parameters" });

  try {
    const addRef = ref(db, `add_member/${username}`);
    for (const m of members) {
      const key = push(addRef).key;
      await set(ref(db, `add_member/${username}/${key}`), {
        user_id: m.user_id || null,
        username: m.username || null,
        firstName: m.firstName || null,
        group: targetGroup,
        createdAt: Date.now()
      });
    }
    res.json({ status:"success", message:`${members.length} members added` });
  } catch (err) {
    res.json({ status:"error", error: err.message });
  }
});

// Delete group
app.delete("/delete-group/:username/:key", async (req, res) => {
  const { username, key } = req.params;
  try {
    await remove(ref(db, `user_groups/${username}/${key}`));
    res.json({ status:"success" });
  } catch (err) {
    res.json({ status:"error", error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log(`Server running at http://localhost:${PORT}`));
