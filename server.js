import 'dotenv/config'
import express from "express"
import { initializeApp } from "firebase/app"
import { getDatabase, ref, set, push } from "firebase/database"

// ===== Firebase config =====
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DB_URL,
  projectId: process.env.FIREBASE_PROJECT_ID
}

const firebaseApp = initializeApp(firebaseConfig)
const db = getDatabase(firebaseApp)

// ===== Express =====
const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json())

// =============================
// CREATE ADD REQUEST
// =============================
app.post("/add-request", async (req, res) => {

  const { username, targetGroup, members } = req.body

  if (!username || !targetGroup || !members || !Array.isArray(members)) {
    return res.status(400).json({
      status: "error",
      error: "Missing username, targetGroup or members[]"
    })
  }

  try {

    const requestKey = push(ref(db, "add_requests")).key

    await set(ref(db, `add_requests/${requestKey}`), {
      createdBy: username,
      targetGroup: targetGroup,
      totalMembers: members.length,
      status: "pending",
      createdAt: Date.now()
    })

    // save members inside request
    for (const m of members) {

      const memberKey = push(ref(db, `add_requests/${requestKey}/members`)).key

      await set(ref(db, `add_requests/${requestKey}/members/${memberKey}`), {
        username: m.username || null,
        user_id: m.user_id || null,
        access_hash: m.access_hash || null,
        status: "pending"
      })

    }

    return res.json({
      status: "success",
      requestId: requestKey,
      message: `Add request created (${members.length} members)`
    })

  } catch (err) {

    console.error("Add request error:", err)

    return res.status(500).json({
      status: "error",
      error: err.message
    })

  }

})


// =============================
// SERVER STATUS
// =============================
app.get("/", (req, res) => {

  res.send("🚀 Telegram Add Members Server PRO++ Running")

})


// =============================
app.listen(PORT, () => {

  console.log(`🚀 Server running on port ${PORT}`)

})
