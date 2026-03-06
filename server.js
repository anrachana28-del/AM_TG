import 'dotenv/config';
import express from "express";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, onChildAdded, set } from "firebase/database";

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

app.use(express.json());

// ===== API to create Add Request =====
app.post("/add-request", async (req, res) => {
  const { username, targetGroup } = req.body;
  if(!username || !targetGroup) return res.status(400).json({ error:"Missing username or targetGroup" });

  try{
    const addRef = ref(db, `add_requests/${Date.now()}`);
    await set(addRef, {
      createdBy: username,
      targetGroup,
      status: "pending",
      createdAt: Date.now()
    });
    res.json({ status:"success", message:`Add request created for ${targetGroup}` });
  } catch(err){
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ===== API to list user's app_members =====
app.get("/app-members/:username", async (req,res)=>{
  const username = req.params.username;
  if(!username) return res.status(400).json({ error:"Missing username" });

  try{
    const membersRef = ref(db, `app_members/${username}`);
    let members = [];
    onChildAdded(membersRef, (snap)=>{
      members.push(snap.val());
    });
    res.json({ status:"success", members });
  } catch(err){
    res.status(500).json({ error: err.message });
  }
});

// ===== Root =====
app.get("/", (req,res)=>{
  res.send("Telegram Add Members Server PRO+++ Live");
});

app.listen(PORT, ()=>console.log(`Server running on port ${PORT}`));