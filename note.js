import 'dotenv/config'
import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions'
import { initializeApp } from 'firebase/app'
import { getDatabase, ref, onChildAdded, set, push, update } from 'firebase/database'

/* ========= Firebase ========= */
const firebaseConfig = {
  apiKey: process.env.FB_API_KEY,
  authDomain: process.env.FB_AUTH_DOMAIN,
  databaseURL: process.env.FB_DB_URL,
  projectId: process.env.FB_PROJECT_ID,
}
const app = initializeApp(firebaseConfig)
const db = getDatabase(app)

/* ========= Telegram ========= */
const apiId = Number(process.env.API_ID_1)
const apiHash = process.env.API_HASH_1
const stringSession = new StringSession(process.env.SESSION_1)

const client = new TelegramClient(
  stringSession,
  apiId,
  apiHash,
  { connectionRetries: 5 }
)

await client.start()
console.log("✅ Telegram connected")

/* ========= Listen Export Requests ========= */
const requestRef = ref(db, "export_requests")

onChildAdded(requestRef, async snap => {
  const reqId = snap.key
  const data = snap.val()

  if (data.status !== "pending") return

  console.log("📤 Export request:", data.groupLink)

  await update(ref(db, `export_requests/${reqId}`), {
    status: "running"
  })

  try {
    const group = await client.getEntity(data.groupLink)
    const members = await client.getParticipants(group, { aggressive: true })

    for (const user of members) {
      if (!user.username) continue

      await push(ref(db, `exported_members/${reqId}/members`), {
        id: user.id,
        username: user.username,
        first_name: user.firstName || ""
      })
    }

    await update(ref(db, `export_requests/${reqId}`), {
      status: "done",
      total: members.length
    })

    console.log("✅ Export done:", members.length)

  } catch (err) {
    console.error(err)
    await update(ref(db, `export_requests/${reqId}`), {
      status: "error",
      error: err.message
    })
  }
})
