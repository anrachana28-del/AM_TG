import 'dotenv/config'
import express from "express"
import { initializeApp } from "firebase/app"
import { getDatabase, ref, get, push, update, onChildAdded } from "firebase/database"
import { TelegramClient, Api } from "telegram"
import { StringSession } from "telegram/sessions/index.js"

/* ==============================
   FIREBASE
============================== */

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DB_URL,
  projectId: process.env.FIREBASE_PROJECT_ID
}

const firebaseApp = initializeApp(firebaseConfig)
const db = getDatabase(firebaseApp)

/* ==============================
   UTIL
============================== */

const sleep = ms => new Promise(r=>setTimeout(r,ms))

/* ==============================
   TELEGRAM CLIENT CACHE
============================== */

const clients = {}

async function getClients(createdBy){

  if(clients[createdBy]) return clients[createdBy]

  const snap = await get(ref(db,"telegram_accounts"))
  const accounts = Object.values(snap.val() || {})
  .filter(a => a.createdBy === createdBy && a.session)

  const list = []

  for(const acc of accounts){

    try{

      const client = new TelegramClient(
        new StringSession(acc.session),
        parseInt(acc.api_id),
        acc.api_hash,
        {connectionRetries:5}
      )

      await client.connect()

      console.log(`🔑 Logged ${acc.api_id}`)

      list.push({
        api_id:acc.api_id,
        client
      })

    }catch(e){

      console.log(`❌ Login failed ${acc.api_id}`)

    }

  }

  clients[createdBy] = list

  return list
}

/* ==============================
   AUTO JOIN GROUP
============================== */

async function joinGroup(client, groupLink){

  try{

    const entity = await client.getEntity(groupLink)

    return entity

  }catch{

    const hash = groupLink.split("/").pop()

    await client.invoke(
      new Api.messages.ImportChatInvite({
        hash
      })
    )

    return await client.getEntity(groupLink)

  }

}

/* ==============================
   EXPORT WORKER
============================== */

onChildAdded(ref(db,"export_requests"), async snapshot => {

  const key = snapshot.key
  const req = snapshot.val()

  if(!req || req.status !== "pending") return

  const {groupLink, createdBy} = req

  console.log(`🚀 EXPORT ${groupLink}`)

  const accounts = await getClients(createdBy)

  if(!accounts.length){

    await update(ref(db,`export_requests/${key}`),{
      status:"error",
      error:"No accounts"
    })

    return
  }

  try{

    const {client} = accounts[0]

    const group = await joinGroup(client, groupLink)

    for await (const user of client.iterParticipants(group)){

      const check = await get(ref(db,`export_requests/${key}`))
      if(check.val()?.status !== "pending") return

      if(user.bot || user.deleted) continue

      await push(ref(db,`exported_members/${createdBy}`),{

        id:user.id.toString(),
        accessHash:user.accessHash?.toString() || null,
        username:user.username || null,
        firstName:user.firstName || null,
        lastName:user.lastName || null,
        profilePhoto:"https://via.placeholder.com/100",
        groupLink,
        createdAt:Date.now()

      })

    }

    await update(ref(db,`export_requests/${key}`),{
      status:"done",
      processedAt:Date.now()
    })

    console.log("✅ EXPORT DONE")

  }catch(e){

    console.log("❌ Export Error",e.message)

    await update(ref(db,`export_requests/${key}`),{
      status:"error",
      error:e.message
    })

  }

})

/* ==============================
   ADD MEMBERS WORKER
============================== */

onChildAdded(ref(db,"add_members_requests"), async snapshot => {

  const key = snapshot.key
  const req = snapshot.val()

  if(!req || req.status !== "pending") return

  const {targetGroup, members, createdBy} = req

  console.log(`📥 ADD → ${targetGroup}`)

  const accounts = await getClients(createdBy)

  if(!accounts.length){

    await update(ref(db,`add_members_requests/${key}`),{
      status:"error",
      error:"No account"
    })

    return
  }

  let index = 0

  for(const m of members){

    const acc = accounts[index % accounts.length]
    const client = acc.client

    try{

      const group = await joinGroup(client,targetGroup)

      const user = new Api.InputUser({
        userId:BigInt(m.id),
        accessHash:BigInt(m.accessHash || 0)
      })

      await client.invoke(
        new Api.channels.InviteToChannel({
          channel:group,
          users:[user]
        })
      )

      await push(ref(db,`added_members/${createdBy}`),{

        username:m.username || null,
        id:m.id,
        group:targetGroup,
        account:acc.api_id,
        createdAt:Date.now()

      })

      console.log(`✅ ${m.username || m.id}`)

      await sleep(5000)

    }catch(e){

      if(e.message.includes("FLOOD_WAIT")){

        const wait = parseInt(e.message.match(/\d+/)?.[0] || 60)

        console.log(`⏳ FloodWait ${wait}`)

        await sleep(wait*1000)

      }else{

        console.log(`❌ ${m.username}`,e.message)

      }

    }

    index++

  }

  await update(ref(db,`add_members_requests/${key}`),{
    status:"done",
    processedAt:Date.now()
  })

  console.log("🎉 ADD COMPLETE")

})

/* ==============================
   EXPRESS SERVER
============================== */

const app = express()

app.get("/",(req,res)=>{
  res.send(`
  <h2>Telegram Worker PRO</h2>
  <p>Status: Running</p>
  `)
})

const PORT = process.env.PORT || 3000

app.listen(PORT,()=>{

  console.log(`🌐 Worker running ${PORT}`)

})
