import { firebaseConfig, iceServers } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, collection, getDoc, setDoc, updateDoc, deleteDoc, addDoc,
  onSnapshot, query, where, orderBy, limit, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const $ = (s) => document.querySelector(s);
const MONTHS = ["yanvar","fevral","mart","aprel","may","iyun","iyul","avgust","sentabr","oktabr","noyabr","dekabr"];
const KINDS = {
  msg:    { send: "Yuborish",           ph: "Xabar yozing…" },
  task:   { send: "Topshiriq yuborish", ph: "Replika matni. Ovoz belgilarini ishlatishingiz mumkin." },
  tip:    { send: "Maslahat yuborish",  ph: "Ijro bo'yicha maslahat yozing…" },
  review: { send: "Fikr yuborish",      ph: "O'quvchi javobiga fikringiz…" }
};

/* ---------------- Yordamchi funksiyalar ---------------- */
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) for (const k in props) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}
const pad = (n) => (n < 10 ? "0" : "") + n;
const fmtTime = (ts) => { const d = new Date(ts); return pad(d.getHours()) + ":" + pad(d.getMinutes()); };
const dayKey = (ts) => { const d = new Date(ts); return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate(); };
function dayLabel(ts) {
  const now = Date.now();
  if (dayKey(ts) === dayKey(now)) return "Bugun";
  if (dayKey(ts) === dayKey(now - 864e5)) return "Kecha";
  const d = new Date(ts);
  return d.getDate() + "-" + MONTHS[d.getMonth()];
}
function hue(str) { let x = 0; for (const c of String(str)) x = (x * 31 + c.charCodeAt(0)) % 360; return x; }
function avatar(name, uid, cls) {
  const el = h("div", { class: cls || "av", text: (String(name || "?").trim()[0] || "?").toUpperCase() });
  el.style.background = "hsl(" + hue(uid || name) + " 45% 36%)";
  return el;
}
let toastTimer = null;
function toast(text) {
  const t = $("#toast");
  t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
}
function show(id) {
  document.querySelectorAll(".screen").forEach((s) => { s.hidden = s.id !== id; });
}
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
};

/* Ovoz belgilarini xavfsiz (textContent orqali) bo'yaydi */
const MARKS = /(\*[^*\n]+\*|\([^)\n]{1,60}\)|(?<![^\s])\/{1,2}(?![^\s])|[↑↓]|~+)/g;
function marked(text) {
  const frag = document.createDocumentFragment();
  String(text).split(MARKS).forEach((p, i) => {
    if (!p) return;
    if (i % 2 === 0) { frag.append(document.createTextNode(p)); return; }
    let cls = "mk-stretch";
    if (p[0] === "*") { cls = "mk-stress"; p = p.slice(1, -1); }
    else if (p[0] === "(") cls = "mk-emo";
    else if (p[0] === "/") cls = "mk-pause";
    else if (p === "↑") cls = "mk-up";
    else if (p === "↓") cls = "mk-down";
    frag.append(h("span", { class: cls, text: p }));
  });
  return frag;
}
function legendNode() {
  const items = [["/", "qisqa pauza"], ["//", "uzun pauza"], ["↑", "ohang ko'tariladi"], ["↓", "ohang tushadi"],
    ["~", "cho'zib aytiladi (ha~yr)"], ["*so'z*", "urg'u beriladi"], ["(pichirlab)", "ijro izohi"]];
  const ul = h("ul");
  items.forEach((it) => ul.append(h("li", null, h("code", { text: it[0] }), h("span", { text: it[1] }))));
  return h("div", { class: "legend" }, h("h3", { text: "Ovoz belgilari" }), ul,
    h("div", { class: "sample" }, h("small", { text: "Namuna" }),
      h("div", { class: "mb" }, marked("Sen... // *haqiqatan* ham ketding? ↑ / (pichirlab) Yo'q, yo'q, bo'lishi mumkin emas~ ↓"))));
}

/* ---------------- Holat ---------------- */
const S = {
  uid: null, name: "", role: null, pickRole: null, knownTeacher: false,
  rooms: [], showArch: false, unsubRooms: null,
  rid: null, room: null, members: new Map(), messages: [],
  kind: "msg", replyTo: null, sending: false, armed: null, armedKick: null,
  subs: [], hb: null, tick: null, forceBottom: false,
  armedFinish: false,
  queue: null, slots: [], subSlots: null, qForm: false, qDraft: "", qAuto: true,
  clock: null, startedFlag: true, lobbyTick: null
};
let app, auth, db;

const memberRef = (uid) => doc(db, "rooms", S.rid, "members", uid);
const isTeacher = () => S.role === "teacher";
function isOnline(m) {
  const ts = m.lastSeen && m.lastSeen.toMillis ? m.lastSeen.toMillis() : Date.now();
  return Date.now() - ts < 90000;
}
const startsAt = () => (S.room && Number(S.room.startsAt)) || 0;
const hasStarted = () => isTeacher() || !startsAt() || Date.now() >= startsAt();
function fmtWhen(ts) { const d = new Date(ts); return d.getDate() + "-" + MONTHS[d.getMonth()] + ", " + fmtTime(ts); }
function fmtLeft(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  if (d) return d + " kun " + hh + " soat";
  if (hh) return hh + " soat " + pad(mm) + " daqiqa";
  if (mm) return mm + " daqiqa " + pad(ss) + " soniya";
  return ss + " soniya";
}
const toLocalInput = (ts) => { const d = new Date(ts); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()); };

/* ---------------- Boshlash ---------------- */
function configured() {
  return firebaseConfig && firebaseConfig.apiKey && !/YOUR_/.test(firebaseConfig.apiKey) && !/YOUR_/.test(firebaseConfig.projectId || "");
}
function boot() {
  wireLogin(); wireLobby(); wireRoom();
  if (!configured()) { show("s-setup"); return; }
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  onAuthStateChanged(auth, async (u) => {
    if (!u) {
      try { await signInAnonymously(auth); }
      catch (e) { show("s-setup"); $("#s-setup").querySelector("p").textContent = "Firebase Authentication ichida «Anonymous» kirish usulini yoqing. Xato: " + (e.code || e.message); }
      return;
    }
    S.uid = u.uid;
    if (S.role) return;
    try {
      const t = await getDoc(doc(db, "teachers", u.uid));
      S.knownTeacher = t.exists();
      if (t.exists() && t.data().name && !$("#nameIn").value) $("#nameIn").value = t.data().name;
    } catch (e) { S.knownTeacher = false; }
    showLogin();
  });
}

/* ---------------- Kirish ---------------- */
function showLogin() {
  show("s-login");
  const saved = store.get("ox_name");
  if (saved && !$("#nameIn").value) $("#nameIn").value = saved;
  const last = store.get("ox_role");
  setRole(last === "teacher" || last === "student" ? last : null);
}
function setRole(r) {
  S.pickRole = r;
  document.querySelectorAll(".role-card").forEach((b) => b.setAttribute("aria-checked", b.dataset.role === r ? "true" : "false"));
  $("#codeField").hidden = !(r === "teacher" && !S.knownTeacher);
  $("#codeHint").textContent = "Kodni platforma egasidan oling.";
  validateLogin();
}
function validateLogin() {
  const ok = S.pickRole && $("#nameIn").value.trim().length >= 2 &&
    (S.pickRole !== "teacher" || S.knownTeacher || $("#codeIn").value.length > 0);
  $("#loginBtn").disabled = !ok;
}
function wireLogin() {
  document.querySelectorAll(".role-card").forEach((b) => b.addEventListener("click", () => setRole(b.dataset.role)));
  $("#nameIn").addEventListener("input", validateLogin);
  $("#codeIn").addEventListener("input", validateLogin);
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#nameIn").value.trim().slice(0, 30), role = S.pickRole, err = $("#loginErr");
    if (!name || !role || !S.uid) return;
    err.hidden = true; $("#loginBtn").disabled = true;
    try {
      if (role === "teacher" && !S.knownTeacher) {
        await setDoc(doc(db, "teachers", S.uid), { name, code: $("#codeIn").value });
        S.knownTeacher = true;
      }
      S.name = name; S.role = role;
      store.set("ox_name", name); store.set("ox_role", role);
      $("#codeIn").value = "";
      showLobby();
    } catch (ex) {
      err.hidden = false;
      err.textContent = ex.code === "permission-denied"
        ? "Ustoz kodi noto'g'ri. Kodni tekshiring yoki platforma egasidan so'rang."
        : "Kirib bo'lmadi: " + (ex.code || ex.message);
      validateLogin();
    }
  });
}

/* ---------------- Darslar ro'yxati ---------------- */
function showLobby() {
  show("s-lobby");
  $("#whoName").textContent = S.name;
  $("#whoRole").textContent = isTeacher() ? "Ustoz" : "O'quvchi";
  $("#newBtn").hidden = !isTeacher();
  $("#archWrap").hidden = !isTeacher();
  if (S.unsubRooms) S.unsubRooms();
  S.unsubRooms = onSnapshot(query(collection(db, "rooms"), orderBy("createdAt", "desc"), limit(100)), (snap) => {
    S.rooms = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderRooms();
  }, () => { $("#roomCards").textContent = "Darslarni yuklab bo'lmadi. Internetni va Firestore qoidalarini tekshiring."; });
  renderRooms();
  clearInterval(S.lobbyTick);
  S.lobbyTick = setInterval(() => { if (!$("#s-lobby").hidden) renderRooms(); }, 30000);
}
function renderRooms() {
  const box = $("#roomCards");
  box.textContent = "";
  const list = S.rooms.filter((r) => S.showArch || !r.archived);
  if (!list.length) {
    box.append(h("p", { class: "empty", text: isTeacher() ? "Hali dars yo'q. «Yangi dars» tugmasi bilan birinchi darsni yarating." : "Hali dars yo'q. Ustoz dars yaratganda shu yerda ko'rinadi." }));
    return;
  }
  list.forEach((r) => {
    box.append(h("button", { class: "rcard", type: "button", onclick: () => enterRoom(r.id) },
      h("h3", { text: r.title || "Nomsiz dars" }),
      r.description ? h("p", { text: r.description }) : null,
      h("div", { class: "m" }, h("span", { class: "pill", text: r.level || "Daraja yo'q" }),
        r.archived ? h("span", { class: "pill warn", text: r.finishedAt ? "Tugagan: " + fmtWhen(r.finishedAt) : "Arxiv" }) : null,
        r.chatLocked ? h("span", { class: "pill", text: "Chat qulflangan" }) : null,
        r.startsAt > Date.now() ? h("span", { class: "pill warn", text: "Boshlanadi: " + fmtWhen(r.startsAt) }) : null)));
  });
}
function wireLobby() {
  $("#logoutBtn").addEventListener("click", () => {
    if (S.unsubRooms) { S.unsubRooms(); S.unsubRooms = null; }
    S.role = null; showLogin();
  });
  $("#archToggle").addEventListener("change", (e) => { S.showArch = e.target.checked; renderRooms(); });
  $("#newBtn").addEventListener("click", () => { const f = $("#newForm"); f.hidden = !f.hidden; if (!f.hidden) $("#nfTitle").focus(); });
  $("#nfCancel").addEventListener("click", () => { $("#newForm").hidden = true; });
  $("#newForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = $("#nfTitle").value.trim(), err = $("#nfErr");
    if (!title) { err.hidden = false; err.textContent = "Dars nomini yozing."; return; }
    const sv = $("#nfStart").value, startsAt = sv ? new Date(sv).getTime() : 0;
    if (sv && (isNaN(startsAt) || startsAt <= Date.now())) { err.hidden = false; err.textContent = "Boshlanish vaqti hozirdan keyin bo'lishi kerak."; return; }
    err.hidden = true; $("#nfSave").disabled = true;
    try {
      const ref = await addDoc(collection(db, "rooms"), {
        title, level: $("#nfLevel").value, description: $("#nfDesc").value.trim(),
        createdBy: S.uid, createdAt: Date.now(), archived: false, chatLocked: false, startsAt
      });
      $("#nfTitle").value = ""; $("#nfDesc").value = ""; $("#nfStart").value = ""; $("#newForm").hidden = true;
      enterRoom(ref.id);
    } catch (ex) { err.hidden = false; err.textContent = "Darsni saqlab bo'lmadi: " + (ex.code || ex.message); }
    $("#nfSave").disabled = false;
  });
}

/* ---------------- Dars xonasiga kirish ---------------- */
async function enterRoom(rid) {
  try {
    S.rid = rid;
    const mref = memberRef(S.uid);
    const snap = await getDoc(mref);
    if (snap.exists() && snap.data().kicked) { S.rid = null; toast("Siz bu darsdan chiqarilgansiz."); return; }
    const teacher = isTeacher();
    if (!snap.exists()) {
      await setDoc(mref, { uid: S.uid, name: S.name, role: S.role, muted: !teacher, micOff: false, hand: false, kicked: false,
        inVoice: false, session: 0, lastSeen: serverTimestamp(), joinedAt: Date.now() });
    } else {
      const up = { name: S.name, lastSeen: serverTimestamp(), inVoice: false };
      if (snap.data().role !== S.role) { up.role = S.role; up.muted = !teacher; }
      await updateDoc(mref, up);
    }
  } catch (e) { S.rid = null; toast("Darsga kirib bo'lmadi: " + (e.code || e.message)); return; }

  if (S.unsubRooms) { S.unsubRooms(); S.unsubRooms = null; }
  clearInterval(S.lobbyTick);
  S.room = (S.rooms.find((r) => r.id === rid)) || null;
  S.members = new Map(); S.messages = []; S.kind = "msg"; S.replyTo = null; S.armed = null; S.armedKick = null;
  S.queue = null; S.slots = []; S.qForm = false; S.qDraft = ""; S.armedFinish = false;
  S.startedFlag = hasStarted();
  show("s-room");
  setTab("chat");
  $("#legendPanel").hidden = true; $("#legendBtn").setAttribute("aria-expanded", "false");
  renderRoomHead(); renderMembers(); renderVoiceCtl(); renderTeacherCtl(); renderMsgs(); renderComposer(); renderQueue(); renderStartBar();

  S.subs.push(onSnapshot(doc(db, "rooms", rid), (d) => {
    if (!d.exists()) { toast("Bu dars o'chirilgan."); leaveRoom(); return; }
    S.room = { id: d.id, ...d.data() };
    if (S.room.archived && !isTeacher()) { toast("Dars tugadi va arxivga o'tdi."); leaveRoom(); return; }
    if (S.room.archived && V.on) leaveVoice(true);
    S.armedFinish = false;
    renderRoomHead(); renderTeacherCtl(); renderComposer(); renderMsgs(); renderVoiceCtl(); renderQueue(); tickClock();
  }));
  S.subs.push(onSnapshot(collection(db, "rooms", rid, "members"), (snap) => {
    S.members = new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
    renderMembers(); renderVoiceCtl(); renderQueue(); renderMsgs();
    applyMute(); reconcilePeers();
  }, () => checkKicked()));
  S.subs.push(onSnapshot(query(collection(db, "rooms", rid, "messages"), orderBy("createdAt", "desc"), limit(200)), (snap) => {
    S.messages = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.createdAt - b.createdAt);
    renderMsgs();
  }, () => checkKicked()));
  S.subs.push(onSnapshot(query(collection(db, "rooms", rid, "queues"), orderBy("createdAt", "desc"), limit(1)), (snap) => {
    const d = snap.docs[0], q = d ? { id: d.id, ...d.data() } : null;
    const changed = (q && q.id) !== (S.queue && S.queue.id);
    S.queue = q;
    if (changed) watchSlots();
    renderQueue();
  }, () => { S.queue = null; renderQueue(); }));
  S.subs.push(onSnapshot(memberRef(S.uid), (d) => { if (d.exists() && d.data().kicked) kickedOut(); }));

  S.hb = setInterval(() => { updateDoc(memberRef(S.uid), { lastSeen: serverTimestamp() }).catch(() => {}); }, 25000);
  S.tick = setInterval(() => { renderQueue(); reconcilePeers(); }, 20000);
  S.clock = setInterval(tickClock, 1000);
}

function kickedOut() {
  if (!S.rid) return;
  toast("Ustoz sizni darsdan chiqardi.");
  leaveRoom(true);
}
function checkKicked() {
  if (!S.rid) return;
  getDoc(memberRef(S.uid)).then((d) => { if (d.exists() && d.data().kicked) kickedOut(); else toast("Ma'lumotlarni o'qib bo'lmadi. Internetni tekshiring."); }).catch(() => {});
}

async function leaveRoom(kicked) {
  await leaveVoice(!kicked);
  S.subs.forEach((u) => u()); S.subs = [];
  clearInterval(S.hb); clearInterval(S.tick); clearInterval(S.clock);
  if (S.subSlots) { S.subSlots(); S.subSlots = null; }
  S.queue = null; S.slots = [];
  if (S.rid && !kicked) updateDoc(memberRef(S.uid), { inVoice: false, hand: false }).catch(() => {});
  S.rid = null; S.room = null; S.members = new Map(); S.messages = [];
  showLobby();
}
window.addEventListener("pagehide", () => {
  if (S.rid && db) updateDoc(memberRef(S.uid), { inVoice: false }).catch(() => {});
});

/* ---------------- Xona sarlavhasi va ustoz boshqaruvi ---------------- */
function renderRoomHead() {
  const r = S.room || {};
  $("#roomTitle").textContent = r.title || "Dars";
  $("#roomMeta").textContent = [r.level, r.archived ? "Arxivda" : null, r.chatLocked ? "Chat qulflangan" : null].filter(Boolean).join(" · ");
}
function renderTeacherCtl() {
  const box = $("#tctl");
  box.hidden = !isTeacher();
  if (!isTeacher()) return;
  box.textContent = "";
  const r = S.room || {};
  if (r.archived) {
    box.append(h("div", { class: "cap", text: "Dars tugagan" }),
      h("p", { class: "hint", text: "Dars arxivga o'tgan. Chat saqlab qo'yilgan va faqat o'qish uchun." }));
    return;
  }
  box.append(
    h("div", { class: "cap", text: "Ustoz boshqaruvi" }),
    h("div", { class: "row" },
      h("button", { class: "btn small", type: "button", text: "Hammasini yopish", onclick: () => muteAll(true) }),
      h("button", { class: "btn small", type: "button", text: "Hammasini ochish", onclick: () => muteAll(false) })),
    h("div", { class: "row" },
      h("button", { class: "btn small", type: "button", text: r.chatLocked ? "Chatni ochish" : "Chatni qulflash", onclick: () => updateDoc(doc(db, "rooms", S.rid), { chatLocked: !r.chatLocked }).catch(() => toast("O'zgartirib bo'lmadi.")) }),
      h("button", { class: "btn small danger", type: "button", text: S.armedFinish ? "Tasdiqlang" : "Darsni tugatish", onclick: finishLesson })),
    schedNode(),
    h("p", { class: "hint", text: "O'quvchilar darsga ovozi yopiq holda kiradi. Qo'l ko'targanlarni shu yerdan ochasiz." }));
}
async function muteAll(val) {
  try {
    const batch = writeBatch(db);
    let n = 0;
    S.members.forEach((m) => { if (m.role === "student" && !m.kicked) { batch.update(memberRef(m.id), { muted: val, hand: false }); n++; } });
    if (n) await batch.commit();
    toast(val ? "Barcha o'quvchilar ovozi yopildi." : "Barcha o'quvchilar ovozi ochildi.");
  } catch (e) { toast("Bajarib bo'lmadi: " + (e.code || e.message)); }
}
async function toggleMute(m) {
  try { await updateDoc(memberRef(m.id), { muted: !m.muted, hand: false }); }
  catch (e) { toast("Bajarib bo'lmadi: " + (e.code || e.message)); }
}
async function kick(m) {
  if (S.armedKick !== m.id) {
    S.armedKick = m.id; renderMembers();
    setTimeout(() => { if (S.armedKick === m.id) { S.armedKick = null; renderMembers(); } }, 3500);
    return;
  }
  S.armedKick = null;
  try { await updateDoc(memberRef(m.id), { kicked: true, inVoice: false, hand: false }); toast(m.name + " darsdan chiqarildi."); }
  catch (e) { toast("Bajarib bo'lmadi: " + (e.code || e.message)); }
}

/* ---------------- Qatnashchilar ro'yxati ---------------- */
function renderMembers() {
  const ul = $("#members");
  if (!ul || !S.rid) return;
  ul.textContent = "";
  const list = [...S.members.values()].filter((m) => !m.kicked && (m.id === S.uid || isOnline(m)));
  list.sort((a, b) => (a.role === b.role ? 0 : a.role === "teacher" ? -1 : 1) || (b.hand ? 1 : 0) - (a.hand ? 1 : 0) || String(a.name).localeCompare(String(b.name)));
  $("#memCount").textContent = "(" + list.length + ")";
  list.forEach((m) => {
    const me = m.id === S.uid, student = m.role === "student";
    const tags = h("div", { class: "st" });
    if (m.role === "teacher") tags.append(h("span", { class: "role", text: "Ustoz" }));
    if (m.inVoice) tags.append(h("span", { class: "tag voice", text: "Ovozda" }));
    if (student && m.muted) tags.append(h("span", { class: "tag closed", text: "Yopiq" }));
    if (student && !m.muted && m.inVoice) tags.append(h("span", { class: "tag voice", text: "Ochiq" }));
    if (m.micOff && m.inVoice) tags.append(h("span", { class: "tag", text: "Mikrofon o'chiq" }));
    if (m.hand) tags.append(h("span", { class: "tag hand", text: "Qo'l ko'targan" }));
    const qp = student ? queuePos(m.id) : null;
    if (qp) tags.append(h("span", { class: "tag" + (qp.now ? " voice" : ""), text: qp.text }));
    const ops = h("div", { class: "ops" });
    if (isTeacher() && student && !me) {
      ops.append(h("button", { class: "btn small" + (m.muted ? " primary" : ""), type: "button", text: m.muted ? "Ochish" : "Yopish", onclick: () => toggleMute(m) }));
      ops.append(h("button", { class: "btn small danger", type: "button", text: S.armedKick === m.id ? "Tasdiqlang" : "Chiqarish", onclick: () => kick(m) }));
    }
    const li = h("li", { class: "mem" + (me ? " me" : ""), "data-uid": m.id },
      avatar(m.name, m.id, "av"),
      h("div", { style: "min-width:0" }, h("div", { class: "nm", text: (m.name || "Ishtirokchi") + (me ? " (siz)" : "") }), tags),
      ops);
    ul.append(li);
  });
  setSpeaking();
}

/* ---------------- Ovozli chat (WebRTC, signalizatsiya Firestore orqali) ---------------- */
const V = { on: false, stream: null, micOn: true, session: 0, peers: new Map(), unsub: null, chain: Promise.resolve(), ctx: null, meters: new Map(), meterTimer: null, speaking: new Set() };

function renderVoiceCtl() {
  const box = $("#vctl");
  if (!box || !S.rid) return;
  box.textContent = "";
  const me = S.members.get(S.uid) || {};
  if ((S.room && S.room.archived)) { box.append(h("p", { class: "vstate", text: "Dars tugagan. Ovozli chat yopiq." })); return; }
  const closed = !isTeacher() && me.muted;
  if (!V.on) {
    const wait = !hasStarted();
    box.append(
      h("button", { class: "btn primary big", type: "button", disabled: wait, text: wait ? "Dars hali boshlanmagan" : "Ovozga ulanish", onclick: joinVoice }),
      h("p", { class: "vstate", text: wait ? "Dars boshlanganda ovozli chat o'zi ochiladi. Shu sahifada kutib turing." : isTeacher() ? "Ulanganingizdan keyin o'quvchilar sizni eshitadi." : "Ulanganingizdan keyin ustozni eshitasiz. Gapirish uchun ustoz ruxsat berishi kerak." }));
    return;
  }
  box.append(h("p", { class: "vstate" }, "Holat: ", h("b", { text: V.stream ? "ovozda" : "faqat tinglash" })));
  if (V.stream) {
    box.append(h("button", { class: "btn", type: "button", "aria-pressed": V.micOn && !closed ? "true" : "false", disabled: closed,
      text: closed ? "Ovozingiz yopiq" : (V.micOn ? "Mikrofon yoqiq" : "Mikrofon o'chiq"), onclick: toggleMic }));
  }
  if (closed) {
    box.append(h("p", { class: "vstate", text: "Ustoz hozircha ovozingizni yopgan. Gapirish uchun qo'l ko'taring." }));
    box.append(h("button", { class: "btn", type: "button", "aria-pressed": me.hand ? "true" : "false", text: me.hand ? "Qo'lni tushirish" : "Qo'l ko'tarish",
      onclick: () => updateDoc(memberRef(S.uid), { hand: !me.hand }).catch(() => {}) }));
  }
  box.append(h("button", { class: "btn ghost", type: "button", text: "Ovozdan chiqish", onclick: () => leaveVoice(true) }));
}

async function joinVoice() {
  if (V.on || !S.rid || !hasStarted() || (S.room && S.room.archived)) return;
  if (!navigator.mediaDevices || !window.RTCPeerConnection) { toast("Brauzeringiz ovozli chatni qo'llamaydi."); return; }
  V.session = Date.now();
  try {
    V.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e) {
    V.stream = null;
    toast("Mikrofonga ruxsat berilmadi. Faqat tinglash rejimida ulandingiz.");
  }
  V.on = true; V.micOn = true;
  try { V.ctx = V.ctx || new (window.AudioContext || window.webkitAudioContext)(); if (V.ctx.resume) await V.ctx.resume(); } catch (e) {}
  if (V.stream) startMeter(S.uid, V.stream);
  applyMute();
  try {
    await updateDoc(memberRef(S.uid), { inVoice: true, session: V.session, micOff: false, lastSeen: serverTimestamp() });
  } catch (e) { toast("Ovozga ulanib bo'lmadi: " + (e.code || e.message)); await leaveVoice(false); return; }
  V.unsub = onSnapshot(query(collection(db, "rooms", S.rid, "signals"), where("to", "==", S.uid)), (snap) => {
    const adds = snap.docChanges().filter((c) => c.type === "added").map((c) => ({ id: c.doc.id, ...c.doc.data() }))
      .sort((a, b) => a.createdAt - b.createdAt);
    adds.forEach((s) => { V.chain = V.chain.then(() => handleSignal(s)).catch((e) => console.error("signal", e)); });
  }, () => toast("Ovoz signallarini o'qib bo'lmadi."));
  renderVoiceCtl(); reconcilePeers();
}

async function leaveVoice(writeDoc) {
  if (!V.on) return;
  V.on = false;
  if (V.unsub) { V.unsub(); V.unsub = null; }
  [...V.peers.keys()].forEach(closePeer);
  if (V.stream) V.stream.getTracks().forEach((t) => t.stop());
  V.stream = null;
  V.meters.forEach((m) => { try { m.src.disconnect(); } catch (e) {} });
  V.meters.clear(); V.speaking.clear();
  clearInterval(V.meterTimer); V.meterTimer = null;
  if (writeDoc && S.rid) { try { await updateDoc(memberRef(S.uid), { inVoice: false }); } catch (e) {} }
  if (S.rid) { renderVoiceCtl(); renderMembers(); }
}

function toggleMic() {
  V.micOn = !V.micOn;
  applyMute();
  updateDoc(memberRef(S.uid), { micOff: !V.micOn }).catch(() => {});
  renderVoiceCtl();
}

/* Mikrofon va qabul qilingan ovozlarni ustoz belgilagan "yopiq" holatga moslaydi */
function applyMute() {
  const me = S.members.get(S.uid) || {};
  const allowed = isTeacher() || !me.muted;
  if (V.stream) V.stream.getAudioTracks().forEach((t) => { t.enabled = allowed && V.micOn; });
  V.peers.forEach((p, uid) => {
    const m = S.members.get(uid);
    p.audio.muted = !!(m && m.role === "student" && m.muted);
  });
}

function sendSignal(to, type, data) {
  return addDoc(collection(db, "rooms", S.rid, "signals"), { from: S.uid, to, type, data, session: V.session, createdAt: Date.now() }).catch((e) => console.error("sendSignal", e));
}

function createPeer(uid, initiator, remoteSession) {
  const pc = new RTCPeerConnection({ iceServers });
  const audio = document.createElement("audio");
  audio.autoplay = true; audio.setAttribute("playsinline", "");
  $("#audioBin").append(audio);
  const peer = { pc, audio, pendingIce: [], initiator, remoteSession: remoteSession || 0 };
  V.peers.set(uid, peer);
  if (V.stream) V.stream.getTracks().forEach((t) => pc.addTrack(t, V.stream));
  else pc.addTransceiver("audio", { direction: "recvonly" });
  pc.ontrack = (e) => {
    const stream = e.streams[0] || new MediaStream([e.track]);
    audio.srcObject = stream;
    audio.play().catch(() => {});
    startMeter(uid, stream);
    applyMute();
  };
  pc.onicecandidate = (e) => { if (e.candidate) sendSignal(uid, "ice", e.candidate.toJSON()); };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") {
      if (V.peers.get(uid) === peer) { closePeer(uid); setTimeout(reconcilePeers, 1500); }
    }
  };
  if (initiator) {
    pc.createOffer().then((o) => pc.setLocalDescription(o).then(() => sendSignal(uid, "offer", { type: o.type, sdp: o.sdp })))
      .catch((e) => console.error("offer", e));
  }
  return peer;
}
function closePeer(uid) {
  const p = V.peers.get(uid);
  if (!p) return;
  V.peers.delete(uid);
  try { p.pc.close(); } catch (e) {}
  p.audio.srcObject = null; p.audio.remove();
  const m = V.meters.get(uid);
  if (m) { try { m.src.disconnect(); } catch (e) {} V.meters.delete(uid); }
  V.speaking.delete(uid);
}
function reconcilePeers() {
  if (!V.on || !S.rid) return;
  S.members.forEach((m, uid) => {
    if (uid === S.uid) return;
    const active = !m.kicked && isOnline(m) && m.inVoice;
    let peer = V.peers.get(uid);
    if (active) {
      if (peer && peer.remoteSession && m.session && peer.remoteSession !== m.session) { closePeer(uid); peer = null; }
      if (!peer && S.uid < uid) createPeer(uid, true, m.session);
    } else if (peer) closePeer(uid);
  });
  V.peers.forEach((p, uid) => { if (!S.members.has(uid)) closePeer(uid); });
}
async function flushIce(p) {
  while (p.pendingIce.length) { try { await p.pc.addIceCandidate(p.pendingIce.shift()); } catch (e) {} }
}
async function handleSignal(s) {
  deleteDoc(doc(db, "rooms", S.rid, "signals", s.id)).catch(() => {});
  if (!V.on || Date.now() - s.createdAt > 120000) return;
  if (s.type === "offer") {
    let p = V.peers.get(s.from);
    if (!p || p.initiator || p.remoteSession !== s.session) { closePeer(s.from); p = createPeer(s.from, false, s.session); }
    await p.pc.setRemoteDescription(s.data);
    await flushIce(p);
    const ans = await p.pc.createAnswer();
    await p.pc.setLocalDescription(ans);
    sendSignal(s.from, "answer", { type: ans.type, sdp: ans.sdp });
  } else if (s.type === "answer") {
    const p = V.peers.get(s.from);
    if (p && p.initiator && !p.pc.currentRemoteDescription) { await p.pc.setRemoteDescription(s.data); await flushIce(p); }
  } else if (s.type === "ice") {
    const p = V.peers.get(s.from);
    if (!p) return;
    if (p.pc.remoteDescription) { try { await p.pc.addIceCandidate(s.data); } catch (e) {} }
    else p.pendingIce.push(s.data);
  }
}

/* Kim gapirayotganini ko'rsatadi */
function startMeter(key, stream) {
  if (!V.ctx || !stream.getAudioTracks().length) return;
  const old = V.meters.get(key);
  if (old) { try { old.src.disconnect(); } catch (e) {} }
  const src = V.ctx.createMediaStreamSource(stream);
  const an = V.ctx.createAnalyser();
  an.fftSize = 512;
  src.connect(an);
  V.meters.set(key, { src, an, buf: new Uint8Array(an.fftSize) });
  if (!V.meterTimer) V.meterTimer = setInterval(meterTick, 140);
}
function meterTick() {
  let changed = false;
  V.meters.forEach((m, key) => {
    m.an.getByteTimeDomainData(m.buf);
    let sum = 0;
    for (let i = 0; i < m.buf.length; i++) { const v = (m.buf[i] - 128) / 128; sum += v * v; }
    const rms = Math.sqrt(sum / m.buf.length);
    const info = S.members.get(key);
    let on;
    if (key === S.uid) { on = rms > 0.03 && V.micOn && (isTeacher() || !(info && info.muted)); }
    else { on = rms > 0.03 && !(info && ((info.role === "student" && info.muted) || info.micOff)); }
    if (on !== V.speaking.has(key)) { on ? V.speaking.add(key) : V.speaking.delete(key); changed = true; }
  });
  if (changed) setSpeaking();
}
function setSpeaking() {
  document.querySelectorAll(".mem").forEach((li) => li.classList.toggle("speaking", V.speaking.has(li.dataset.uid)));
}

/* ---------------- Dars vaqti (avtomatik boshlanish) ---------------- */
function renderStartBar() {
  const bar = $("#startBar");
  if (!bar) return;
  const t = startsAt();
  if (S.rid && (S.room && S.room.archived)) { bar.hidden = false; bar.textContent = "Dars tugagan va arxivga o'tgan. Chat saqlab qo'yilgan, faqat o'qish mumkin."; return; }
  if (!S.rid || !t || Date.now() >= t) { bar.hidden = true; return; }
  bar.hidden = false;
  bar.textContent = "Dars " + fmtWhen(t) + " da boshlanadi · " + fmtLeft(t - Date.now()) + " qoldi" +
    (isTeacher() ? "" : ". Boshlanganda chat va ovoz o'zi ochiladi.");
}
function tickClock() {
  if (!S.rid) return;
  renderStartBar();
  const now = hasStarted();
  if (now !== S.startedFlag) {
    S.startedFlag = now;
    if (now && !isTeacher()) toast("Dars boshlandi!");
    renderVoiceCtl(); renderComposer();
  }
}
function schedNode() {
  const t = startsAt(), pending = t && Date.now() < t;
  const inp = h("input", { class: "input", id: "schedIn", type: "datetime-local", "aria-label": "Dars boshlanish vaqti" });
  if (t) inp.value = toLocalInput(t);
  return h("div", { class: "sched" },
    h("label", { for: "schedIn", text: "Dars boshlanish vaqti" }), inp,
    h("div", { class: "row" },
      h("button", { class: "btn small", type: "button", text: "Vaqtni saqlash", onclick: saveSched }),
      pending ? h("button", { class: "btn small", type: "button", text: "Hozir boshlash", onclick: startNow }) : null),
    h("p", { class: "hint", text: pending
      ? "Vaqt kelganda dars o'zi ochiladi. O'sha paytgacha o'quvchilar yozolmaydi va ovozga ulana olmaydi."
      : "Vaqt belgilansa, o'quvchilar shu paytgacha kutadi va dars o'zi ochiladi." }));
}
async function saveSched() {
  const v = $("#schedIn").value, ts = v ? new Date(v).getTime() : 0;
  if (!ts || isNaN(ts)) { toast("Boshlanish vaqtini tanlang."); return; }
  if (ts <= Date.now()) { toast("Vaqt hozirdan keyin bo'lishi kerak. Hoziroq ochish uchun «Hozir boshlash» ni bosing."); return; }
  try { await updateDoc(doc(db, "rooms", S.rid), { startsAt: ts }); toast("Dars " + fmtWhen(ts) + " da boshlanadi."); }
  catch (e) { toast("Saqlab bo'lmadi: " + (e.code || e.message)); }
}
async function finishLesson() {
  if (!S.armedFinish) {
    S.armedFinish = true; renderTeacherCtl();
    setTimeout(() => { if (S.armedFinish) { S.armedFinish = false; renderTeacherCtl(); } }, 3500);
    return;
  }
  S.armedFinish = false;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "rooms", S.rid), { archived: true, finished: true, finishedAt: Date.now(), chatLocked: true });
    if (S.queue && S.queue.status !== "done") batch.update(qRef(), { status: "done" });
    await batch.commit();
    toast("Dars tugadi va arxivga o'tdi. Chat saqlab qo'yildi.");
  } catch (e) { toast("Bajarib bo'lmadi: " + (e.code || e.message)); renderTeacherCtl(); }
}
async function startNow() {
  try { await updateDoc(doc(db, "rooms", S.rid), { startsAt: 0 }); toast("Dars boshlandi."); }
  catch (e) { toast("Bajarib bo'lmadi: " + (e.code || e.message)); }
}

/* ---------------- Navbat ---------------- */
const qRef = () => doc(db, "rooms", S.rid, "queues", S.queue.id);
const slotRef = (id) => doc(db, "rooms", S.rid, "queues", S.queue.id, "slots", String(id));

function watchSlots() {
  if (S.subSlots) { S.subSlots(); S.subSlots = null; }
  S.slots = [];
  if (!S.queue) return;
  S.subSlots = onSnapshot(collection(db, "rooms", S.rid, "queues", S.queue.id, "slots"), (snap) => {
    S.slots = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderQueue();
  }, () => {});
}
function studentCount() {
  return [...S.members.values()].filter((m) => m.role === "student" && !m.kicked && (m.id === S.uid || isOnline(m))).length;
}
/* Katakchalar soni = darsdagi o'quvchilar soni (band katak yo'qolib qolmasligi uchun eng katta band raqamgacha) */
function slotTotal() { return Math.max(studentCount(), 0, ...S.slots.map((s) => Number(s.n) || 0)); }
function queuePos(uid) {
  const q = S.queue;
  if (!q || q.status === "done") return null;
  if (q.status === "open") { const s = S.slots.find((x) => x.uid === uid); return s ? { text: "Navbat: " + s.n, now: false } : null; }
  const i = (q.order || []).findIndex((x) => x.uid === uid);
  if (i < 0) return null;
  return i === q.current ? { text: "Hozir navbati", now: true } : { text: "Navbat: " + (i + 1), now: false };
}

function renderQueue() {
  renderMembers();
  const box = $("#qpanel");
  if (!box || !S.rid) return;
  const q = S.queue, teacher = isTeacher(), active = !!q && q.status !== "done";
  box.hidden = !!(S.room && S.room.archived) || (!active && !teacher);
  if (box.hidden) return;
  const ae = document.activeElement;
  if (ae && box.contains(ae) && ae.tagName === "INPUT" && ae.type !== "checkbox") return;
  box.textContent = "";
  box.append(h("div", { class: "cap", text: active ? "Navbat: " + (q.title || "Navbat") : "Navbat" }));

  if (!active) {
    if (!S.qForm) {
      box.append(
        h("p", { class: "hint", text: "O'quvchilar o'zlariga navbat tanlashi uchun navbat yarating. Katakchalar soni darsdagi o'quvchilar soniga teng bo'ladi." }),
        h("button", { class: "btn small", type: "button", text: "Navbat yaratish", onclick: () => { S.qForm = true; renderQueue(); const i = $("#qTitle"); if (i) i.focus(); } }));
      return;
    }
    box.append(
      h("div", { class: "field" }, h("label", { for: "qTitle", text: "Navbat nomi" }),
        h("input", { class: "input", id: "qTitle", maxlength: "60", placeholder: "Masalan: 1-topshiriq", value: S.qDraft, oninput: (e) => { S.qDraft = e.target.value; } })),
      h("label", { class: "check" },
        h("input", { type: "checkbox", checked: S.qAuto, onchange: (e) => { S.qAuto = e.target.checked; } }),
        "Navbati kelgan o'quvchining ovozini avtomatik ochish"),
      h("div", { class: "row" },
        h("button", { class: "btn primary small", type: "button", text: "Yaratish", onclick: createQueue }),
        h("button", { class: "btn small", type: "button", text: "Bekor qilish", onclick: () => { S.qForm = false; renderQueue(); } })));
    return;
  }

  if (q.status === "open") {
    const total = slotTotal(), mine = S.slots.find((s) => s.uid === S.uid);
    box.append(h("p", { class: "hint", text: teacher
      ? "O'quvchilar katakchani tanlayapti. Band: " + S.slots.length + " / " + total + ". Band katakni bosib bo'shatishingiz mumkin."
      : (mine ? "Sizning navbatingiz: " + mine.n + ". O'zgartirish uchun boshqa katakni, bekor qilish uchun o'zingiznikini bosing." : "O'zingizga qulay navbatni tanlang.") }));
    if (!total) box.append(h("p", { class: "hint", text: "Darsda hali o'quvchi yo'q." }));
    const grid = h("div", { class: "slots" });
    for (let i = 1; i <= total; i++) {
      const s = S.slots.find((x) => Number(x.n) === i), isMine = !!s && s.uid === S.uid;
      let click = null, dis = true, title = "";
      if (teacher) { if (s) { dis = false; click = () => freeSlot(s); title = "Bo'shatish"; } }
      else if (!s || isMine) { dis = false; click = isMine ? () => freeSlot(s) : () => claimSlot(i); }
      grid.append(h("button", { class: "slot" + (isMine ? " mine" : s ? " taken" : ""), type: "button", disabled: dis, title, onclick: click },
        h("b", { text: i }), h("span", { text: s ? s.name : "Bo'sh" })));
    }
    box.append(grid);
    if (teacher) box.append(
      h("div", { class: "row" },
        h("button", { class: "btn primary small", type: "button", text: "Tayyor", disabled: !S.slots.length, onclick: readyQueue }),
        h("button", { class: "btn small", type: "button", text: "Bekor qilish", onclick: closeQueue })),
      h("p", { class: "hint", text: "«Tayyor» bosilganda bo'sh qolgan katakchalar olib tashlanadi va navbatlar ketma-ket tartibga keladi." }));
    return;
  }

  const order = q.order || [], cur = q.current || 0, myIdx = order.findIndex((p) => p.uid === S.uid);
  if (!teacher) box.append(h("p", { class: "hint", text: myIdx < 0 ? "Siz bu navbatga yozilmagansiz."
    : myIdx === cur ? "Navbat sizda!" : myIdx < cur ? "Sizning navbatingiz o'tdi." : "Sizdan oldin " + (myIdx - cur) + " kishi bor." }));
  const ol = h("ol", { class: "qorder" });
  order.forEach((p, i) => ol.append(h("li", { class: (i === cur ? "now" : i < cur ? "past" : "") + (p.uid === S.uid ? " me" : "") },
    h("b", { text: i + 1 }), h("span", { class: "nm", text: p.name + (p.uid === S.uid ? " (siz)" : "") }),
    h("small", { text: i === cur ? "Hozir" : i < cur ? "O'tdi" : "Kutmoqda" }))));
  box.append(ol);
  if (teacher) box.append(
    h("div", { class: "row" },
      h("button", { class: "btn primary small", type: "button", text: cur >= order.length - 1 ? "Tugatish" : "Keyingi", onclick: nextTurn }),
      h("button", { class: "btn small", type: "button", text: "Yopish", onclick: closeQueue })),
    q.autoMic ? h("p", { class: "hint", text: "Navbati kelgan o'quvchining ovozi avtomatik ochiladi, qolganlariniki yopiladi." }) : null);
}

async function createQueue() {
  const title = ($("#qTitle").value.trim() || "Navbat").slice(0, 60);
  try {
    await addDoc(collection(db, "rooms", S.rid, "queues"), { title, createdBy: S.uid, createdAt: Date.now(), status: "open", autoMic: !!S.qAuto, order: [], current: 0 });
    S.qForm = false; S.qDraft = "";
  } catch (e) { toast("Navbat yaratib bo'lmadi: " + (e.code || e.message)); }
}
async function claimSlot(n) {
  if (!S.queue || S.queue.status !== "open") return;
  const mine = S.slots.find((s) => s.uid === S.uid);
  try {
    const batch = writeBatch(db);
    if (mine) batch.delete(slotRef(mine.id));
    batch.set(slotRef(n), { uid: S.uid, name: S.name, n, createdAt: Date.now() });
    await batch.commit();
  } catch (e) { toast(e.code === "permission-denied" ? "Bu o'rin allaqachon band yoki navbat yopilgan." : "Tanlab bo'lmadi: " + (e.code || e.message)); }
}
function freeSlot(s) { deleteDoc(slotRef(s.id)).catch(() => toast("Bajarib bo'lmadi.")); }
function closeQueue() { updateDoc(qRef(), { status: "done" }).catch(() => toast("Bajarib bo'lmadi.")); }

/* Navbati kelgan o'quvchining ovozini ochadi, qolgan o'quvchilarniki yopiladi */
function turnMics(batch, uid) {
  S.members.forEach((m) => {
    if (m.role !== "student" || m.kicked) return;
    if (m.id === uid) batch.update(memberRef(m.id), { muted: false, hand: false });
    else if (!m.muted) batch.update(memberRef(m.id), { muted: true });
  });
}
/* «Tayyor»: bo'sh qolgan va darsdan ketgan o'quvchilar katakchalari olib tashlanadi, qolganlar ketma-ket tartibga keladi */
async function readyQueue() {
  const q = S.queue;
  if (!q || q.status !== "open") return;
  const total = slotTotal();
  const valid = S.slots.filter((s) => { const m = S.members.get(s.uid); return m && !m.kicked && m.role === "student" && isOnline(m); })
    .sort((a, b) => Number(a.n) - Number(b.n));
  if (!valid.length) { toast("Hali hech kim navbat tanlamagan."); return; }
  const order = valid.map((s) => ({ uid: s.uid, name: s.name }));
  try {
    const batch = writeBatch(db);
    batch.update(qRef(), { status: "running", order, current: 0 });
    if (q.autoMic) turnMics(batch, order[0].uid);
    await batch.commit();
    const gaps = total - order.length;
    toast("Navbat boshlandi: " + order.length + " ishtirokchi" + (gaps > 0 ? ", " + gaps + " ta bo'sh katak olib tashlandi." : "."));
  } catch (e) { toast("Bajarib bo'lmadi: " + (e.code || e.message)); }
}
async function nextTurn() {
  const q = S.queue;
  if (!q || q.status !== "running") return;
  const order = q.order || [], next = (q.current || 0) + 1;
  try {
    const batch = writeBatch(db);
    if (next >= order.length) batch.update(qRef(), { status: "done" });
    else { batch.update(qRef(), { current: next }); if (q.autoMic) turnMics(batch, order[next].uid); }
    await batch.commit();
  } catch (e) { toast("Bajarib bo'lmadi: " + (e.code || e.message)); }
}

/* ---------------- Yozuv chati ---------------- */
function canWrite() { return !(S.room && S.room.archived) && (isTeacher() || (hasStarted() && !(S.room && S.room.chatLocked))); }

function renderMsgs() {
  const box = $("#msgs");
  if (!box || !S.rid) return;
  const near = S.forceBottom || (box.scrollHeight - box.scrollTop - box.clientHeight < 140);
  S.forceBottom = false;
  box.textContent = "";
  const r = S.room || {};
  if (r.description) box.append(h("div", { class: "plan" }, h("small", { text: "Dars maqsadi" }), h("p", { text: r.description })));
  if (!S.messages.length) {
    box.append(h("p", { class: "empty", text: isTeacher() ? "Hali xabar yo'q. «Topshiriq» turini tanlab, birinchi replikani yuboring." : "Hali xabar yo'q. Ustoz topshiriq yuborganda shu yerda paydo bo'ladi." }));
  }
  let prevDay = "", prev = null;
  S.messages.forEach((m) => {
    const dk = dayKey(m.createdAt);
    if (dk !== prevDay) { box.append(h("div", { class: "daysep" }, h("span", { text: dayLabel(m.createdAt) }))); prevDay = dk; prev = null; }
    const cont = prev && prev.uid === m.uid && prev.kind === "msg" && m.kind === "msg" && !m.replyTo && (m.createdAt - prev.createdAt) < 300000;
    box.append(msgEl(m, cont));
    prev = m;
  });
  if (near) box.scrollTop = box.scrollHeight;
}
function msgEl(m, cont) {
  const mine = m.uid === S.uid;
  const el = h("article", { class: "msg" + (cont ? " cont" : ""), id: "m-" + m.id });
  el.append(cont ? h("span", { class: "av-sp" }) : avatar(m.name, m.uid, "av"));
  const col = h("div", { style: "min-width:0" });
  if (!cont) col.append(h("div", { class: "mh" }, h("span", { class: "n", text: m.name || "Ishtirokchi" }),
    m.role === "teacher" ? h("span", { class: "role", text: "Ustoz" }) : null, h("span", { class: "tm", text: fmtTime(m.createdAt) })));
  if (m.replyTo) {
    const src = S.messages.find((x) => x.id === m.replyTo);
    col.append(h("button", { class: "quote", type: "button", onclick: () => { const t = document.getElementById("m-" + m.replyTo); if (t) t.scrollIntoView({ block: "center" }); } },
      src ? "↳ " + src.name + ": " + String(src.text).replace(/\s+/g, " ").slice(0, 90) : "↳ O'chirilgan xabar"));
  }
  const body = h("div", { class: "mb" }, marked(m.text || ""));
  if (m.kind === "task") {
    col.append(h("div", { class: "card task" }, h("div", { class: "lab" }, h("span", { text: "Topshiriq" }),
      m.character ? h("span", { class: "chip", text: "Personaj: " + m.character }) : null,
      m.emotion ? h("span", { class: "chip", text: "Hissiyot: " + m.emotion }) : null), body));
  } else if (m.kind === "tip") col.append(h("div", { class: "card tip" }, h("div", { class: "lab", text: "Maslahat" }), body));
  else if (m.kind === "review") col.append(h("div", { class: "card review" }, h("div", { class: "lab", text: "Ustoz fikri" }), body));
  else col.append(body);
  const acts = h("div", { class: "acts" });
  if (canWrite()) acts.append(h("button", { class: "act", type: "button", text: "Javob", onclick: () => setReply(m) }));
  if ((mine || isTeacher()) && !(S.room && S.room.archived)) {
    const armed = S.armed === m.id;
    acts.append(h("button", { class: "act" + (armed ? " armed" : ""), type: "button", text: armed ? "Tasdiqlang" : "O'chirish", onclick: () => delMsg(m) }));
  }
  if (acts.children.length) col.append(acts);
  el.append(col);
  return el;
}
function delMsg(m) {
  if (S.armed !== m.id) {
    S.armed = m.id; renderMsgs();
    setTimeout(() => { if (S.armed === m.id) { S.armed = null; renderMsgs(); } }, 3500);
    return;
  }
  S.armed = null;
  deleteDoc(doc(db, "rooms", S.rid, "messages", m.id)).catch(() => toast("O'chirib bo'lmadi."));
}

function note(text, err) {
  const n = $("#composeNote");
  n.textContent = text || ""; n.hidden = !text; n.className = "note" + (err ? " err" : "");
}
function renderComposer() {
  if (!S.rid) return;
  const can = canWrite();
  $("#composer").hidden = !!(S.room && S.room.archived);
  $("#kindRow").hidden = !(isTeacher());
  if (!isTeacher()) S.kind = "msg";
  [...$("#kindRow").children].forEach((b) => b.setAttribute("aria-pressed", b.dataset.kind === S.kind ? "true" : "false"));
  $("#taskRow").hidden = !(isTeacher() && S.kind === "task");
  const ta = $("#ta");
  ta.disabled = !can;
  $("#sendBtn").disabled = !can || S.sending;
  ta.placeholder = can ? KINDS[S.kind].ph : "";
  $("#sendBtn").textContent = KINDS[S.kind].send;
  $("#markBar").hidden = !can;
  if (!can) note(!hasStarted() ? "Dars hali boshlanmagan. Boshlanganda chat o'zi ochiladi." : "Ustoz chatni qulflagan. Hozircha yozib bo'lmaydi.");
  else if ($("#composeNote").className.indexOf("err") < 0) note("");
  const chip = $("#replyChip");
  chip.textContent = "";
  if (S.replyTo) {
    chip.hidden = false;
    chip.append(h("span", { text: "↳ " + S.replyTo.name + ": " + String(S.replyTo.text).replace(/\s+/g, " ").slice(0, 80) }),
      h("button", { class: "act", type: "button", text: "Bekor qilish", onclick: () => { S.replyTo = null; renderComposer(); } }));
  } else chip.hidden = true;
}
function setReply(m) {
  S.replyTo = m;
  if (isTeacher() && m.role !== "teacher") S.kind = "review";
  renderComposer();
  $("#ta").focus();
}
function autosize() { const t = $("#ta"); t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 160) + "px"; }
function insertMark(a, b) {
  const t = $("#ta");
  if (t.disabled) return;
  const s = t.selectionStart, e = t.selectionEnd, v = t.value, sel = v.slice(s, e);
  const ins = b == null ? a : a + sel + b;
  if (v.length - (e - s) + ins.length > t.maxLength) return;
  t.value = v.slice(0, s) + ins + v.slice(e);
  const pos = b == null ? s + ins.length : (sel ? s + ins.length : s + a.length);
  t.focus(); t.setSelectionRange(pos, pos); autosize();
}
async function send() {
  const ta = $("#ta"), text = ta.value.trim();
  if (!text || S.sending || !canWrite() || !S.rid) return;
  const kind = isTeacher() ? S.kind : "msg";
  const data = { uid: S.uid, name: S.name, role: S.role, text, kind, createdAt: Date.now() };
  if (S.replyTo) data.replyTo = S.replyTo.id;
  if (kind === "task") {
    const c = $("#charIn").value.trim(), em = $("#emoIn").value.trim();
    if (c) data.character = c;
    if (em) data.emotion = em;
  }
  S.sending = true; $("#sendBtn").disabled = true; note("");
  try {
    await addDoc(collection(db, "rooms", S.rid, "messages"), data);
    ta.value = ""; autosize(); S.replyTo = null; S.forceBottom = true;
    if (kind === "review") S.kind = "msg";
  } catch (e) {
    note(e.code === "permission-denied" ? "Yuborishga ruxsat yo'q. Chat qulflangan bo'lishi mumkin." : "Yuborib bo'lmadi. Matn saqlandi, qayta urinib ko'ring.", true);
  }
  S.sending = false; renderComposer();
}

function setTab(tab) {
  $("#roomBody").dataset.tab = tab;
  document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === tab ? "true" : "false"));
}
function wireRoom() {
  $("#leaveBtn").addEventListener("click", () => leaveRoom(false));
  document.querySelectorAll("#tabs button").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
  [...$("#kindRow").children].forEach((b) => b.addEventListener("click", () => { S.kind = b.dataset.kind; renderComposer(); }));
  $("#legendBtn").addEventListener("click", function () {
    const p = $("#legendPanel"), open = p.hidden;
    if (open) { p.textContent = ""; p.append(legendNode()); }
    p.hidden = !open; this.setAttribute("aria-expanded", open ? "true" : "false");
  });
  const bar = $("#markBar");
  [["/", " / ", null], ["//", " // ", null], ["↑", " ↑", null], ["↓", " ↓", null], ["~", "~", null], ["*urg'u*", "*", "*"], ["(izoh)", "(", ")"]].forEach((m) => {
    bar.append(h("button", { class: "mk", type: "button", text: m[0], title: "Belgi qo'shish", onclick: () => insertMark(m[1], m[2]) }));
  });
  const ta = $("#ta");
  ta.addEventListener("input", autosize);
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !window.matchMedia("(pointer: coarse)").matches) { e.preventDefault(); send(); }
  });
  $("#composer").addEventListener("submit", (e) => { e.preventDefault(); send(); });
}

boot();