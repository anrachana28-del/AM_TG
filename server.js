/* ---------------- FIREBASE ---------------- */
firebase.initializeApp({
  apiKey: "AIzaSyAuPx4zukNE-TnBClJbTocOwem0twM1KU0",
  authDomain: "tool-add.firebaseapp.com",
  projectId: "tool-add"
});
const db = firebase.firestore();

let accounts=[], membersLog=[], allMembers=[];

/* ---------------- SAMPLE MEMBER DATA ---------------- */
allMembers=[
  {id:"1001", username:"john_doe", lastOnline:new Date(), hasProfile:true, groups:["GroupA","GroupB"]},
  {id:"1002", username:"jane", lastOnline:new Date(Date.now()-8*24*3600*1000), hasProfile:false, groups:["GroupB"]},
  {id:"1003", username:"alice123", lastOnline:new Date(Date.now()-20*24*3600*1000), hasProfile:true, groups:["GroupC"]},
  {id:"1004", username:"bob", lastOnline:new Date(Date.now()-40*24*3600*1000), hasProfile:false, groups:["GroupA"]},
];

/* ---------------- ENV PARSER ---------------- */
function parseEnv(text){
  const lines=text.split(/\r?\n/);
  const accs=[];
  for(let i=1;;i++){
    const apiId=lines.find(l=>l.startsWith(`API_ID_${i}=`));
    const apiHash=lines.find(l=>l.startsWith(`API_HASH_${i}=`));
    const session=lines.find(l=>l.startsWith(`SESSION_${i}=`));
    if(!apiId||!apiHash||!session) break;
    accs.push({
      name:`account${i}`,
      apiId:apiId.split("=")[1],
      apiHash:apiHash.split("=")[1],
      session:session.split("=")[1],
      phone:(lines.find(l=>l.startsWith(`PHONE_${i}=`))||"").split("=")[1]||"",
      blocked:false,
      blockReason:"",
      blockEnd:0
    });
  }
  return accs;
}

/* ---------------- FIREBASE ---------------- */
function saveFB(){
  const batch=db.batch();
  accounts.forEach(acc=>{
    batch.set(db.collection("accounts").doc(acc.name),acc);
  });
  batch.commit();
}
async function loadFB(){
  const snap=await db.collection("accounts").get();
  accounts=[];
  snap.forEach(doc=>accounts.push(doc.data()));
  render();
}

/* ---------------- RENDER MODAL ---------------- */
function render(){
  const tbody=document.getElementById("modalAccountsList");
  const selected=JSON.parse(localStorage.getItem("selectedAccounts")||"[]");
  tbody.innerHTML="";
  const now=Date.now();
  accounts.forEach(acc=>{
    let statusTxt="Active", reasonTxt="-";
    if(acc.blocked){
      statusTxt="Blocked";
      if(acc.blockReason==="FLOOD" && acc.blockEnd>now){
        reasonTxt=`${acc.blockReason} (until ${new Date(acc.blockEnd).toLocaleString()})`;
      } else { reasonTxt=acc.blockReason||"-"; }
    }
    const tr=document.createElement("tr");
    tr.className=acc.blocked?"blocked":"";
    tr.innerHTML=`
      <td><input type="checkbox" ${selected.includes(acc.name)?"checked":""} ${acc.blocked?"disabled":""} onchange="toggleSelect('${acc.name}',this.checked)"></td>
      <td>${acc.name}</td>
      <td>${acc.apiId}</td>
      <td>${acc.phone}</td>
      <td>${statusTxt}</td>
      <td class="reason">${reasonTxt}</td>
      <td><button onclick="toggleBlock('${acc.name}')">${acc.blocked?"Unblock":"Block"}</button></td>
    `;
    tbody.appendChild(tr);
  });
  document.getElementById("totalAcc").innerText=accounts.length;
  document.getElementById("blockedAcc").innerText=accounts.filter(a=>a.blocked).length;
}

/* ---------------- SELECT ---------------- */
function toggleSelect(name,checked){
  let sel=JSON.parse(localStorage.getItem("selectedAccounts")||"[]");
  if(checked) sel=[...new Set([...sel,name])];
  else sel=sel.filter(x=>x!==name);
  localStorage.setItem("selectedAccounts",JSON.stringify(sel));
}

/* ---------------- BLOCK ---------------- */
function toggleBlock(name){
  const acc=accounts.find(a=>a.name===name);
  if(!acc.blocked){
    const reason = prompt("Block reason (FLOOD / BANNED / LIMIT)","FLOOD");
    if(!reason) return;
    acc.blocked=true;
    acc.blockReason=reason.toUpperCase();
    if(acc.blockReason==="FLOOD"){ const minutes=30; acc.blockEnd=Date.now()+minutes*60*1000; } 
    else { acc.blockEnd=0; }
  } else { acc.blocked=false; acc.blockReason=""; acc.blockEnd=0; }
  saveFB(); render();
}

/* ---------------- MODAL ---------------- */
function openModal(){ document.getElementById("accountModal").classList.add("show"); loadFB(); }
function closeModal(){ document.getElementById("accountModal").classList.remove("show"); }

/* ---------------- LOAD ENV ---------------- */
function loadEnvFile(){
  const f=document.getElementById("envFile").files[0];
  if(!f) return alert("Select .env file");
  const r=new FileReader();
  r.onload=e=>{
    accounts=parseEnv(e.target.result);
    saveFB();
    render();
    alert("Loaded "+accounts.length+" accounts");
  };
  r.readAsText(f);
}

/* ---------------- FILTER + EXPORT ---------------- */
function applyFiltersBySource(){
  const sourceGroup = document.getElementById("sourceGroup").value.trim().toLowerCase();
  let filtered = allMembers.slice(); 
  const memFilter = document.getElementById("filterMembers").value;
  const lastFilter = document.getElementById("filterLastOnline").value;
  const photoFilter = document.getElementById("filterPhoto").value;
  const now = Date.now();

  if(sourceGroup) filtered = filtered.filter(m => m.groups && m.groups.some(g => g.toLowerCase().includes(sourceGroup)));
  if(memFilter==="username") filtered = filtered.filter(m=>m.username);
  if(lastFilter==="week") filtered = filtered.filter(m=>now-m.lastOnline.getTime()<=7*24*3600*1000);
  if(lastFilter==="month") filtered = filtered.filter(m=>now-m.lastOnline.getTime()<=30*24*3600*1000);
  if(photoFilter==="has") filtered = filtered.filter(m=>m.hasProfile);

  document.getElementById("users").value = filtered.map(m=>m.username||m.id).join("\n");
}

document.getElementById("sourceGroup").addEventListener("input", applyFiltersBySource);
document.getElementById("filterMembers").addEventListener("change", applyFiltersBySource);
document.getElementById("filterLastOnline").addEventListener("change", applyFiltersBySource);
document.getElementById("filterPhoto").addEventListener("change", applyFiltersBySource);

/* ---------------- ADD MEMBER SIMULATION ---------------- */
async function addMember(account,user){
  try{
    if(Math.random()<0.2){ 
      const waitSec=Math.floor(Math.random()*300)+60; 
      account.blocked=true; account.blockReason="FLOOD"; account.blockEnd=Date.now()+waitSec*1000;
      saveFB(); render();
      logMember(account.name,user,`Blocked FLOOD_WAIT (${waitSec}s)`);
      return;
    }
    logMember(account.name,user,"Success");
  }catch(err){ console.error(err);}
}

/* ---------------- LOG ---------------- */
function logMember(acc,user,msg){
  const div=document.getElementById("memberList");
  div.innerHTML+=`[${new Date().toLocaleTimeString()}] ${acc} -> ${user}: ${msg}<br>`;
  div.scrollTop=div.scrollHeight;
  membersLog.push({time:new Date(),account:acc,user,status:msg});
}

/* ---------------- MULTI ACCOUNT LOOP ---------------- */
let isRunning=false;
function sleep(ms){ return new Promise(resolve=>setTimeout(resolve,ms)); }

async function startAddMembersLoop(){
  const selectedAccNames = JSON.parse(localStorage.getItem("selectedAccounts")||"[]");
  if(selectedAccNames.length===0) return alert("No accounts selected!");
  let users = document.getElementById("users").value.split("\n").filter(u=>u);
  if(users.length===0) return alert("No members to add!");
  isRunning=true;
  let accIndex=0;
  while(isRunning && users.length){
    const accName=selectedAccNames[accIndex % selectedAccNames.length];
    const account=accounts.find(a=>a.name===accName);
    if(!account || account.blocked){ accIndex++; continue; }
    const user = users.shift();
    await addMember(account,user);
    const delaySeconds = 20; // per account
    logMember(account.name,user,`Delay ${delaySeconds}s before next`);
    for(let i=delaySeconds;i>0;i--){
      if(!isRunning) break;
      document.getElementById("memberList").innerHTML+=`<span style="color:#fbbf24">[${account.name}] Next in ${i}s</span><br>`;
      await sleep(1000);
    }
    accIndex++;
  }
  isRunning=false;
  alert("All members processed!");
}
function stopAddMembersLoop(){ isRunning=false; }

/* ---------------- AUTO UNBLOCK FLOOD ---------------- */
setInterval(()=>{
  const now=Date.now(); let changed=false;
  accounts.forEach(acc=>{
    if(acc.blocked && acc.blockReason==="FLOOD" && acc.blockEnd>0 && now>=acc.blockEnd){
      acc.blocked=false; acc.blockReason=""; acc.blockEnd=0; changed=true;
    }
  });
  if(changed){ saveFB(); render();}
},1000);

/* ---------------- EXPORT CSV ---------------- */
function exportMembersCSV(){
  if(!membersLog.length){ return alert("No member logs to export"); }
  const header="Time,Account,User,Status\n";
  const rows=membersLog.map(e=>{
    const timeStr=e.time.toLocaleString();
    return `"${timeStr}","${e.account}","${e.user}","${e.status}"`;
  });
  const csvContent=header+rows.join("\n");
  const blob=new Blob([csvContent],{type:"text/csv"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url; a.download=`members_log_${new Date().toISOString().split("T")[0]}.csv`; a.click();
  URL.revokeObjectURL(url);
  alert("Members log exported as CSV!");
}

/* ---------------- PLACEHOLDER ---------------- */
function restart(){ alert("Restart") }