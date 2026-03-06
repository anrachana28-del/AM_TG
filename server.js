import 'dotenv/config';
import express from "express";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, set, push } from "firebase/database";

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DB_URL,
  projectId: process.env.FIREBASE_PROJECT_ID,
};

const appFirebase = initializeApp(firebaseConfig);
const db = getDatabase(appFirebase);
const app = express();
app.use(express.json());

app.post("/add-request-auto", async (req,res) => {
  const { username, targetGroup, maxCount } = req.body;
  if(!username || !targetGroup) return res.status(400).json({ error:"Missing username or targetGroup" });

  try{
    const membersSnap = await ref(db, `exported_members/${username}`);
    const snapshot = await new Promise((resolve,reject)=>{
      onValue(ref(db, `exported_members/${username}`), snap=>resolve(snap), err=>reject(err));
    });

    if(!snapshot.exists()) return res.json({ status:"empty", message:"No members to add" });

    const members = Object.values(snapshot.val()).filter(m=>m.username);
    const toAdd = maxCount ? members.slice(0, maxCount) : members;

    for(const member of toAdd){
      const addRef = ref(db, `export_requests/${Date.now()}_${member.username}`);
      await set(addRef, {
        createdBy: username,
        targetGroup,
        memberUsername: member.username,
        status: "pending",
        createdAt: Date.now()
      });
    }

    res.json({ status:"success", added: toAdd.length });

  } catch(err){
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, ()=>console.log("Server running on 3000"));
