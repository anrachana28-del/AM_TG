import 'dotenv/config'

import { initializeApp } from "firebase/app"
import { getDatabase, ref, onChildAdded, update } from "firebase/database"

console.log("🚀 Telegram Worker Started")

/* ===============================
   Firebase Config
================================ */

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DB_URL,
  projectId: process.env.FIREBASE_PROJECT_ID
}

const app = initializeApp(firebaseConfig)
const db = getDatabase(app)

/* ===============================
   Account Rotation
================================ */

let accounts = []
let accIndex = 0

function loadAccounts(){

  accounts = [
    { phone: "account1" },
    { phone: "account2" },
    { phone: "account3" }
  ]

  console.log("Accounts Loaded:", accounts.length)
}

function getNextAccount(){

  const acc = accounts[accIndex]

  accIndex = (accIndex + 1) % accounts.length

  return acc
}

/* ===============================
   Flood Wait Handler
================================ */

async function handleFloodWait(err){

  if(!err) return

  const msg = err.message || ""

  if(msg.includes("FLOOD_WAIT")){

    const sec = parseInt(msg.split("_").pop()) || 60

    console.log("⚠ FloodWait:", sec,"seconds")

    await new Promise(r=>setTimeout(r, sec*1000))

  }

}

/* ===============================
   Telegram Operation Placeholder
================================ */

async function telegramAddMember(account, targetGroup, member){

  console.log(`Adding @${member.username} using ${account.phone}`)

  /* 
  PLACE TELEGRAM CODE HERE
  Example:
  await client.invoke(...)
  */

  await new Promise(r=>setTimeout(r,2000))

  return true
}

/* ===============================
   Process Member
================================ */

async function processMember(reqId, username, targetGroup, member){

  const account = getNextAccount()

  try{

    await update(
      ref(db,`add_members_requests/${username}/${reqId}/members/0`),
      {
        status:"processing",
        account:account.phone
      }
    )

    const success = await telegramAddMember(
      account,
      targetGroup,
      member
    )

    if(success){

      await update(
        ref(db,`add_members_requests/${username}/${reqId}/members/0`),
        {
          status:"done",
          processedAt:Date.now(),
          account:account.phone
        }
      )

      console.log("✅ Added:", member.username)

    }

  }catch(err){

    console.log("❌ Error:", err.message)

    await handleFloodWait(err)

    await update(
      ref(db,`add_members_requests/${username}/${reqId}/members/0`),
      {
        status:"failed",
        error:err.message,
        processedAt:Date.now()
      }
    )

  }

}

/* ===============================
   Listen Requests
================================ */

function startListener(){

  const rootRef = ref(db,"add_members_requests")

  onChildAdded(rootRef, userSnap=>{

    const username = userSnap.key

    const userReqRef = ref(db,`add_members_requests/${username}`)

    onChildAdded(userReqRef, async snap=>{

      const reqId = snap.key
      const req = snap.val()

      if(!req) return

      if(req.status !== "pending") return

      console.log("📥 New Request:", reqId)

      const targetGroup = req.targetGroup
      const members = req.members || []

      for(const member of members){

        await processMember(
          reqId,
          username,
          targetGroup,
          member
        )

      }

    })

  })

}

/* ===============================
   Start Worker
================================ */

async function start(){

  loadAccounts()

  startListener()

}

start()
