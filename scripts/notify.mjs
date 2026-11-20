// Wysyła powiadomienia push o zadaniach, gdy aplikacja jest zamknięta (uruchamiany przez GitHub Actions).
// Importuje logikę terminów bezpośrednio z js/core.js, więc zawsze zgadza się z tym, co pokazuje aplikacja.
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validatePlan, taskAlert, taskTrigger, taskSubjectName, taskTitle, taskCat, morningSummary, fromDK, dk, fmtT, day0, same } from "../js/core.js";
import { VAPID_PUBLIC } from "../js/config.js";
import { sendPush, resolveVapidPrivate } from "./webpush.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATE_DIR = path.resolve(process.env.STATE_DIR || ROOT);

const readJson = (dir, f, def) => {
  try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return def; }
};
const writeJson = (dir, f, o) => {
  fs.writeFileSync(path.join(dir, f), JSON.stringify(o, null, 2) + "\n");
};

const DRY = process.env.DRY_RUN === "true";
const TEST = process.env.TEST === "true";
const CHECK_NEXT = process.argv.includes("--next");
const WINDOW_MIN = Number(process.env.WINDOW_MINUTES || 75);
const now = process.env.NOW ? new Date(process.env.NOW) : new Date();

const vapidPublic = process.env.VAPID_PUBLIC_KEY || VAPID_PUBLIC;
const vapidPrivateRaw = process.env.VAPID_PRIVATE_KEY || "";
const subject = process.env.VAPID_SUBJECT || "https://sajm-n.github.io/itplanzajec/";
if (!vapidPublic) { console.error("Brak klucza publicznego VAPID w js/config.js."); process.exit(1); }

/* Tryb --check (uruchamiany na starcie pętli): sprawdza, czy sekret pasuje do klucza publicznego. */
if (process.argv.includes("--check")) {
  if (!vapidPrivateRaw) {
    console.log("::error::Brak sekretu VAPID_PRIVATE_KEY (Settings → Secrets and variables → Actions).");
    process.exit(1);
  }
  try {
    resolveVapidPrivate(vapidPrivateRaw, vapidPublic);
    console.log("Klucz VAPID poprawny.");
    process.exit(0);
  } catch (e) {
    console.log("::error::" + e.message);
    process.exit(1);
  }
}

/* ----- Treść powiadomień (zgodna z alertTexts w js/push.js) ----- */
const dl = (d) => d.toLocaleDateString("pl-PL", { day: "numeric", month: "long" });

function buildTexts(plan, t) {
  const sub = taskSubjectName(plan, t);
  const cat = taskCat(t);
  const hasTx = !!(typeof t.text === "string" && t.text.trim());
  const name = hasTx ? t.text.trim() : sub || taskTitle(t);
  const noteSnip = (t.note || "").trim().replace(/\s+/g, " ").slice(0, 90);
  const prefix = cat === "exam" ? "Kolokwium" : cat === "report" ? "Sprawozdanie" : cat === "project" ? "Projekt" : "Zadanie";
  const d = fromDK(t.due);
  const td = day0(now);
  const tm = new Date(td.getFullYear(), td.getMonth(), td.getDate() + 1);
  const w = same(d, td) ? "dziś" : same(d, tm) ? "jutro" : dl(d);
  const dayPrep = w === "dziś" ? "na dziś" : w === "jutro" ? "na jutro" : "na " + w;
  const whenFull = w + (t.time ? " o " + fmtT(t.time) : "");
  return {
    title: "!!! " + (cat === "task" ? "Niewykonane zadanie " : prefix + " ") + dayPrep + ": " + name + " !!!",
    body: [sub && hasTx ? sub : "", "termin: " + whenFull, noteSnip].filter(Boolean).join(" · "),
  };
}

/* ----- Dane ----- */
const v = validatePlan(readJson(ROOT, "plan.json", null));
if (!v.ok) { console.error("plan.json: " + v.error); process.exit(1); }
const plan = v.plan;

const validSub = (s) =>
  s &&
  typeof s.endpoint === "string" &&
  /^https:\/\//.test(s.endpoint) &&
  s.keys &&
  typeof s.keys.p256dh === "string" &&
  typeof s.keys.auth === "string";

const subsRaw = readJson(STATE_DIR, "push-subscriptions.json", []);
let subs = Array.isArray(subsRaw) ? subsRaw.filter(validSub) : [];
const state = readJson(STATE_DIR, "push-state.json", { sent: {} });
if (!state.sent || typeof state.sent !== "object") state.sent = {};
const stateBefore = JSON.stringify(state);
const subsBefore = JSON.stringify(subs);

const todayKey = dk(day0(now));
const morningId = "morning:" + todayKey;
const live = new Set(plan.tasks.map((t) => t.id));
live.add(morningId);
for (const k of Object.keys(state.sent)) if (!live.has(k)) delete state.sent[k];
if (!state.fail || typeof state.fail !== "object") state.fail = {};

const dev = (s) => crypto.createHash("sha256").update(s.endpoint).digest("hex").slice(0, 12);
const startOf = (t) => taskTrigger(t, plan.notif).start.getTime();
const deliveredId = (id, minTs, s) => {
  const val = state.sent[id];
  if (typeof val === "number") return true;
  const ts = val && val[dev(s)];
  return !!ts && ts >= minTs;
};
const delivered = (t, s) => deliveredId(t.id, startOf(t), s);
const markSent = (id, s) => {
  if (typeof state.sent[id] === "number" || !state.sent[id]) state.sent[id] = {};
  state.sent[id][dev(s)] = Date.now();
};

/* Poranny skrót dnia (jeśli włączony w plan.notif.morning i dziś są zajęcia lub zadania) */
function getMorningWindow() {
  const m = plan.notif && plan.notif.morning;
  if (!m || !m.on) return null;
  const sum = morningSummary(plan, now);
  if (!sum) return null;
  const [hh, mm] = (m.time || "07:30").split(":").map(Number);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  return { id: morningId, start, end, payload: Object.assign({}, sum, { tag: "morning-" + todayKey, url: "./" }) };
}

/* Tryb --next: sprawdza, czy w najbliższych WINDOW_MIN minutach jakieś zadanie lub poranny skrót wymaga powiadomienia.
   Kod wyjścia 0 = warto czekać w pętli; kod 10 = brak zadań w oknie (można od razu zakończyć workflow). */
if (CHECK_NEXT) {
  if (!subs.length) {
    console.log(JSON.stringify({ shouldLoop: false, reason: "no_subs" }));
    process.exit(10);
  }
  const nowMs = now.getTime();
  const horizonMs = nowMs + WINDOW_MIN * 60 * 1000;
  let dueNow = 0;
  let nextAt = Infinity;
  for (const t of plan.tasks) {
    if (t.done) continue;
    const w = taskTrigger(t, plan.notif);
    if (!w) continue;
    if (t.at && w.start.getTime() < t.at) continue;
    if (nowMs > w.end.getTime()) continue;
    if (!subs.some((s) => !delivered(t, s))) continue;
    const sMs = w.start.getTime();
    if (sMs <= nowMs) dueNow++;
    if (sMs < nextAt) nextAt = sMs;
  }
  const mw = getMorningWindow();
  if (mw && nowMs <= mw.end.getTime() && subs.some((s) => !deliveredId(mw.id, mw.start.getTime(), s))) {
    const sMs = mw.start.getTime();
    if (sMs <= nowMs) dueNow++;
    if (sMs < nextAt) nextAt = sMs;
  }
  const shouldLoop = dueNow > 0 || nextAt <= horizonMs;
  const info = {
    shouldLoop,
    dueNow,
    nextAt: Number.isFinite(nextAt) ? new Date(nextAt).toISOString() : null,
    nextInMin: Number.isFinite(nextAt) ? Math.max(0, Math.round((nextAt - nowMs) / 60000)) : null,
  };
  console.log(JSON.stringify(info));
  process.exit(shouldLoop ? 0 : 10);
}

/* Sygnał życia pętli (zapisywany wyłącznie na gałęzi push-state, nigdy na main) */
if (!TEST && !DRY && !(Date.parse(state.hb) > now.getTime() - 30 * 60 * 1000)) {
  state.hb = now.toISOString();
}

const jobs = TEST
  ? [{ id: "test", minTs: 0, payload: { title: "eStudia", body: "To jest testowe powiadomienie push — działa przy zamkniętej aplikacji.", tag: "test", url: "./" } }]
  : plan.tasks
      .filter((t) => taskAlert(t, now, plan.notif) === "soon" && subs.some((s) => !delivered(t, s)))
      .map((t) => ({
        id: t.id,
        minTs: startOf(t),
        payload: Object.assign(buildTexts(plan, t), { tag: t.id, url: "./?task=" + encodeURIComponent(t.id) }),
      }));

if (!TEST) {
  const mw = getMorningWindow();
  if (mw && now >= mw.start && now <= mw.end && subs.some((s) => !deliveredId(mw.id, mw.start.getTime(), s))) {
    jobs.push({ id: mw.id, minTs: mw.start.getTime(), payload: mw.payload });
  }
}

console.log(now.toString() + " · powiadomień do wysłania: " + jobs.length + " · urządzeń: " + subs.length);
if (!jobs.length) finish(0);
if (!subs.length) {
  console.log("Brak zapisanych urządzeń — nic nie wysyłam (powiadomienia zostaną wysłane, gdy urządzenie się zapisze).");
  finish(0);
}
if (DRY) {
  for (const j of jobs) console.log("[DRY_RUN]", JSON.stringify(j.payload));
  finish(0);
}
if (!vapidPrivateRaw) {
  console.log("::error::Brak sekretu VAPID_PRIVATE_KEY — dodaj go w Settings → Secrets and variables → Actions. Powiadomienia nie zostały wysłane.");
  finish(1);
}
let vapidPrivate;
try {
  vapidPrivate = resolveVapidPrivate(vapidPrivateRaw, vapidPublic);
} catch (e) {
  console.log("::error::" + e.message + " Powiadomienia nie zostały wysłane.");
  finish(1);
}

let failed = false;
const gone = new Set();
const MAX_FAILS = 6;
for (const j of jobs) {
  let okCount = 0;
  for (const s of subs) {
    if (gone.has(s.endpoint)) continue;
    if (j.id !== "test" && deliveredId(j.id, j.minTs, s)) continue;
    const d = dev(s);
    const host = new URL(s.endpoint).host;
    try {
      const r = await sendPush(s, j.payload, { publicKey: vapidPublic, privateKey: vapidPrivate, subject });
      if (r.ok) {
        okCount++;
        delete state.fail[d];
        if (j.id !== "test") markSent(j.id, s);
      } else if (r.gone) {
        gone.add(s.endpoint);
        console.log("Urządzenie " + d + " (" + host + "): subskrypcja wygasła (" + r.status + ").");
      } else {
        failed = true;
        state.fail[d] = (state.fail[d] || 0) + 1;
        console.log("::warning::Push nie przyjęty (" + r.status + ") " + host + " " + d + " " + r.text);
        if (state.fail[d] >= MAX_FAILS) gone.add(s.endpoint);
      }
    } catch (e) {
      failed = true;
      console.log("::warning::Błąd wysyłki: " + e.message);
    }
  }
  console.log("Powiadomienie " + j.id + ": dostarczono teraz na " + okCount + " urządzeń.");
}

if (gone.size) {
  for (const s of subs) if (gone.has(s.endpoint)) delete state.fail[dev(s)];
  subs = subs.filter((s) => !gone.has(s.endpoint));
  console.log("Usunięto martwe subskrypcje: " + gone.size);
}
finish(failed ? 1 : 0);

function finish(code) {
  if (JSON.stringify(state) !== stateBefore) writeJson(STATE_DIR, "push-state.json", state);
  if (JSON.stringify(subs) !== subsBefore) writeJson(STATE_DIR, "push-subscriptions.json", subs);
  process.exit(code);
}
