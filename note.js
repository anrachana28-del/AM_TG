// note.js - Live update of Telegram PRO Worker
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, onChildAdded, onValue, update } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// --- Firebase Config ---
const firebaseConfig = {
  apiKey: "AIzaSyCpmV3xv-HIxWDm8vgNoNtLHAUpyBcFHTI",
  authDomain: "tool-74d29.firebaseapp.com",
  databaseURL: "https://tool-74d29-default-rtdb.firebaseio.com",
  projectId: "tool-74d29"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// --- DOM Elements ---
const historyListEl = document.getElementById("historyList");
const exportStatsEl = document.getElementById("exportStats");

// --- State ---
let totalAdded = 0;
let totalFailed = 0;

// --- Listen to add_members_requests realtime ---
const historyRef = ref(db, "add_members_requests");
onChildAdded(historyRef, snap => {
  const req = snap.val();
  if (!req.members) return;

  req.members.forEach(member => {
    const li = document.createElement("li");
    const status = member.status === "done" ? "✅ Done" : member.status === "fail" ? "❌ Failed" : "⏳ Pending";
    li.classList.add(member.status === "done" ? "status-success" : member.status === "fail" ? "status-fail" : "");
    li.innerHTML = `
      <img class="avatar" src="${member.profilePhoto || 'https://via.placeholder.com/30'}">
      <span class="username">@${member.username}</span>
      <span class="status">${status} 
      (${member.processedAt ? new Date(member.processedAt).toLocaleString() : "Pending"})
      | Target: <a href="${member.targetGroup}" target="_blank">Link</a>
      </span>
    `;
    historyListEl.appendChild(li);
    historyListEl.scrollTo({ top: historyListEl.scrollHeight, behavior: "smooth" });

    // Update totals
    if(member.status === "done") totalAdded++;
    if(member.status === "fail") totalFailed++;
    exportStatsEl.textContent = `Added: ${totalAdded} | Failed: ${totalFailed}`;
  });
});

// --- Optional: live update status if backend updates member ---
onValue(historyRef, snap => {
  // This listens to any change and updates live DOM if status changes
  snap.forEach(reqSnap => {
    const req = reqSnap.val();
    if (!req.members) return;
    req.members.forEach(member => {
      const existingLi = Array.from(historyListEl.children).find(li => li.querySelector(".username").textContent === `@${member.username}`);
      if(existingLi){
        const status = member.status === "done" ? "✅ Done" : member.status === "fail" ? "❌ Failed" : "⏳ Pending";
        existingLi.querySelector(".status").innerHTML = `${status} (${member.processedAt ? new Date(member.processedAt).toLocaleString() : "Pending"}) | Target: <a href="${member.targetGroup}" target="_blank">Link</a>`;
      }
    });
  });
});
