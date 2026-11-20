/* ===== Przypomnienia, powiadomienia systemowe i Web Push =====
   Urządzenie zapisuje swoją subskrypcję push w repozytorium (push-subscriptions.json na gałęzi push-state).
   Workflow GitHub Actions (.github/workflows/notify.yml) wysyła powiadomienia na zapisane urządzenia. */

import { SEEN_KEY, VAPID_PUBLIC, PUSH_FILE, PUSH_STATE_FILE, PUSH_BRANCH, PUSH_KEY, PUSHVAPID_KEY } from "./config.js";
import { day0, same, fromDK, fmtT, taskAlert, taskTrigger, taskSubjectName, taskTitle, taskCat } from "./core.js";
import { cfg, cache, ghFile, b64e, b64d } from "./sync.js";
import { $, esc, dl, hm, lsSet } from "./state.js";

export function taskLabel(t) {
  return taskSubjectName(cache.plan, t);
}

export function whenWord(t) {
  const d = fromDK(t.due);
  const td = day0(new Date());
  const tm = new Date(td.getFullYear(), td.getMonth(), td.getDate() + 1);
  return same(d, td) ? "dziś" : same(d, tm) ? "jutro" : dl(d);
}

/* Ujednolicona treść powiadomienia dla zadania / kolokwium / sprawozdania */
export function alertTexts(a) {
  const t = a.t;
  const w = whenWord(t);
  const sub = taskLabel(t);
  const cat = taskCat(t);
  const hasTx = !!(typeof t.text === "string" && t.text.trim());
  const name = hasTx ? t.text.trim() : sub || taskTitle(t);
  const noteSnip = (t.note || "").trim().replace(/\s+/g, " ").slice(0, 90);
  const prefix = cat === "exam" ? "Kolokwium" : cat === "report" ? "Sprawozdanie" : cat === "project" ? "Projekt" : "Zadanie";
  const whenFull = w + (t.time ? " o " + fmtT(t.time) : "");

  if (a.s === "over") {
    return {
      title: "!!! " + prefix + " po terminie: " + name + " !!!",
      body: [sub && hasTx ? sub : "", "termin minął (" + dl(fromDK(t.due)) + (t.time ? ", " + fmtT(t.time) : "") + ")"]
        .filter(Boolean)
        .join(" · "),
      line: "po terminie (" + dl(fromDK(t.due)) + ")",
    };
  }
  const dayPrep = w === "dziś" ? "na dziś" : w === "jutro" ? "na jutro" : "na " + w;
  return {
    title: "!!! " + (cat === "task" ? "Niewykonane zadanie " : prefix + " ") + dayPrep + ": " + name + " !!!",
    body: [sub && hasTx ? sub : "", "termin: " + whenFull, noteSnip].filter(Boolean).join(" · "),
    line: "termin: " + whenFull,
  };
}

const tkKey = (t) => (t.due ? t.due + (t.time || "23:59") : "9");

export function activeAlerts() {
  const n = new Date();
  return cache.plan.tasks
    .map((t) => ({ t, s: taskAlert(t, n, cache.plan.notif) }))
    .filter((x) => x.s)
    .sort((a, b) => (a.s === b.s ? 0 : a.s === "over" ? 1 : -1) || tkKey(a.t).localeCompare(tkKey(b.t)));
}

export function renderAlerts() {
  const al = activeAlerts();
  const box = $("alerts");
  box.hidden = !al.length;
  box.innerHTML =
    al
      .slice(0, 3)
      .map(
        (a) =>
          '<div class="al"><button type="button" class="alm" data-a="tk:' +
          esc(a.t.id) +
          '"><b>!!!</b>' +
          esc(a.t.text) +
          "<small>" +
          esc(taskLabel(a.t)) +
          " · " +
          esc(alertTexts(a).line) +
          '</small></button><button type="button" class="ald" data-a="tg:' +
          esc(a.t.id) +
          '" aria-label="Oznacz jako ukończone: ' +
          esc(a.t.text) +
          '">Zrobione</button></div>'
      )
      .join("") +
    (al.length > 3 ? '<div class="al more">…i jeszcze ' + (al.length - 3) + " pilnych zadań</div>" : "");
  try {
    if (navigator.setAppBadge) {
      const p = al.length ? navigator.setAppBadge(al.length) : navigator.clearAppBadge();
      if (p && p.catch) p.catch(() => {});
    }
  } catch (e) {}
  renderNotifState();
  notifyDue();
}

/* Powiadomienia systemowe (Web Notifications). Każde zadanie dostaje jedno; wysyłane, gdy aplikacja działa. */
export const notifState = () => ("Notification" in window ? Notification.permission : "unsupported");

const loadSeen = () => {
  try {
    const o = JSON.parse(localStorage.getItem(SEEN_KEY));
    if (o && typeof o === "object") return o;
  } catch (e) {}
  return {};
};
const saveSeen = (o) => {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(o)); } catch (e) {}
};

export async function showNotif(title, body, tag) {
  try {
    const reg =
      navigator.serviceWorker && navigator.serviceWorker.getRegistration
        ? await navigator.serviceWorker.getRegistration()
        : null;
    if (reg && reg.showNotification) {
      await reg.showNotification(title, { body, tag, lang: "pl", data: { url: tag && tag !== "test" ? "./?task=" + encodeURIComponent(tag) : "./" } });
      return true;
    }
  } catch (e) {}
  try {
    new Notification(title, { body, tag, lang: "pl" });
    return true;
  } catch (e) {
    return false;
  }
}

let notifying = false;
export async function notifyDue() {
  if (notifying || notifState() !== "granted") return;
  notifying = true;
  try {
    const seen = loadSeen();
    const live = new Set(cache.plan.tasks.map((t) => t.id));
    let ch = false;
    for (const k in seen) {
      if (!live.has(k)) { delete seen[k]; ch = true; }
    }
    for (const a of activeAlerts()) {
      if (a.s !== "soon") continue;
      /* zadanie, któremu przesunięto termin powiadomienia na później niż poprzednie wysłanie, dostaje powiadomienie ponownie */
      const w = taskTrigger(a.t, cache.plan.notif);
      const sn = seen[a.t.id];
      if (sn && (!w || sn >= w.start.getTime())) continue;
      const x = alertTexts(a);
      if (await showNotif(x.title, x.body, a.t.id)) {
        seen[a.t.id] = Date.now();
        ch = true;
      }
    }
    if (ch) saveSeen(seen);
  } finally {
    notifying = false;
  }
}

export function askNotif() {
  if (!("Notification" in window)) return;
  try {
    const r = Notification.requestPermission(() => {});
    if (r && r.then) {
      r.then(
        () => {
          renderNotifState();
          notifyDue();
          ensurePush();
        },
        () => renderNotifState()
      );
    }
  } catch (e) {
    renderNotifState();
  }
}

/* ----- Web Push (gałąź push-state) ----- */
export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const keyBytes = (s) => {
  const b = (s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const r = atob(b);
  return Uint8Array.from(r, (c) => c.charCodeAt(0));
};

/* Subskrypcja zapisana pod innym kluczem VAPID (np. po wymianie klucza) nie przyjmie powiadomień: trzeba ją odnowić. */
function pushKeyStale(sub) {
  const k = sub && sub.options && sub.options.applicationServerKey;
  if (k) {
    const a = new Uint8Array(k);
    const b = keyBytes(VAPID_PUBLIC);
    return a.length !== b.length || a.some((v, i) => v !== b[i]);
  }
  try {
    return localStorage.getItem(PUSHVAPID_KEY) !== VAPID_PUBLIC;
  } catch (e) {
    return false;
  }
}

function swReady() {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error("Usługa działająca w tle nie jest gotowa. Otwórz aplikację ponownie z internetem.")), 8000)
    ),
  ]);
}

/* Dopisuje subskrypcję tego urządzenia do pliku na gałęzi push-state (z ponowieniem przy równoczesnym zapisie) */
async function savePushSub(sub) {
  const j = sub.toJSON();
  const mine = { endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth }, added: Date.now() };
  for (let i = 0; i < 3; i++) {
    let list = [];
    let sha = null;
    const g = await ghFile(PUSH_FILE, "GET", null, PUSH_BRANCH);
    if (g.status === 200) {
      const o = await g.json();
      sha = o.sha;
      try {
        const a = JSON.parse(b64d(o.content || ""));
        if (Array.isArray(a)) list = a;
      } catch (e) {}
    } else if (g.status === 401) {
      return { ok: false, msg: "Token jest nieprawidłowy lub wygasł." };
    } else if (g.status !== 404) {
      return { ok: false, msg: "GitHub zwrócił błąd " + g.status + "." };
    }
    list = list.filter((x) => x && x.endpoint && x.endpoint !== mine.endpoint);
    list.push(mine);
    list = list.slice(-10);
    const body = {
      message: "Powiadomienia: zapisano urządzenie",
      content: b64e(JSON.stringify(list, null, 2) + "\n"),
      branch: PUSH_BRANCH,
    };
    if (sha) body.sha = sha;
    const p = await ghFile(PUSH_FILE, "PUT", body, PUSH_BRANCH);
    if (p.ok) return { ok: true };
    if (p.status === 409 || p.status === 422) continue;
    if (p.status === 403) {
      return { ok: false, msg: "Token nie ma uprawnienia do zapisu w repozytorium (Contents: Read and write)." };
    }
    return { ok: false, msg: "GitHub zwrócił błąd " + p.status + "." };
  }
  return { ok: false, msg: "Nie udało się zapisać urządzenia (konflikt zapisu). Spróbuj ponownie." };
}

export async function enablePush() {
  if (!pushSupported()) return { ok: false, msg: "Ta przeglądarka nie obsługuje powiadomień push." };
  if (!cfg.token) return { ok: false, msg: "Wymaga trybu serwerowego — podaj token GitHub w sekcji Synchronizacja." };
  if (notifState() !== "granted") return { ok: false, msg: "Najpierw zezwól na powiadomienia." };
  try {
    const reg = await swReady();
    let sub = await reg.pushManager.getSubscription();
    if (sub && pushKeyStale(sub)) {
      try { await sub.unsubscribe(); } catch (e) {}
      sub = null;
    }
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC) });
    }
    const r = await savePushSub(sub);
    if (r.ok) {
      lsSet(PUSH_KEY, sub.endpoint);
      lsSet(PUSHVAPID_KEY, VAPID_PUBLIC);
    }
    return r;
  } catch (e) {
    return { ok: false, msg: "Nie udało się włączyć: " + (e && e.message ? e.message : e) };
  }
}

/* Po cichu dba o to, by to urządzenie było zapisane (po przyznaniu zgody i podaniu tokena) */
let pushBusy = false;
export async function ensurePush() {
  if (pushBusy || !pushSupported() || !cfg.token || notifState() !== "granted") return;
  pushBusy = true;
  try {
    const reg = await swReady();
    const sub = await reg.pushManager.getSubscription();
    let saved = "";
    try { saved = localStorage.getItem(PUSH_KEY) || ""; } catch (e) {}
    if (!sub || sub.endpoint !== saved || pushKeyStale(sub)) await enablePush();
  } catch (e) {
  } finally {
    pushBusy = false;
    renderPushState();
  }
}

export async function renderPushState() {
  const st = $("pushStat");
  const ac = $("pushActs");
  if (!st || !ac) return;
  const msg = (t, k) => {
    st.textContent = t;
    st.className = "msg" + (k ? " " + k : "");
  };
  if (!pushSupported()) {
    msg(
      "Przy zamkniętej aplikacji: ta przeglądarka nie obsługuje powiadomień push. Na iPhonie (iOS 16.4 lub nowszy) dodaj stronę do ekranu głównego i otwieraj ją z ikony.",
      ""
    );
    ac.innerHTML = "";
    return;
  }
  if (!cfg.token) {
    msg("Przy zamkniętej aplikacji: wymaga trybu serwerowego — podaj token GitHub w sekcji Synchronizacja.", "");
    ac.innerHTML = "";
    return;
  }
  if (notifState() !== "granted") {
    msg("Przy zamkniętej aplikacji: najpierw włącz powiadomienia powyżej.", "");
    ac.innerHTML = "";
    return;
  }
  let on = false;
  try {
    const reg = await swReady();
    const sub = await reg.pushManager.getSubscription();
    on = !!sub && sub.endpoint === (localStorage.getItem(PUSH_KEY) || "") && !pushKeyStale(sub);
  } catch (e) {}
  if (!$("pushStat")) return;
  msg(
    on ? "Przy zamkniętej aplikacji: włączone na tym urządzeniu." : "Przy zamkniętej aplikacji: jeszcze nie włączone na tym urządzeniu.",
    on ? "ok" : "warn"
  );
  ac.innerHTML =
    '<button type="button" class="btn' +
    (on ? "" : " pri") +
    '" data-sh="pushon">' +
    (on ? "Odśwież zapis urządzenia" : "Włącz powiadomienia przy zamkniętej aplikacji") +
    "</button>";
}

export function renderNotifState() {
  const st = notifState();
  const el = $("ntStat");
  const ac = $("ntActs");
  const h = $("ntHint");
  if (h) h.hidden = st !== "default";
  if (el) {
    el.textContent = {
      unsupported:
        "Ta przeglądarka nie obsługuje powiadomień. Na iPhonie dodaj stronę do ekranu głównego (Udostępnij → Do ekranu początkowego) i otwieraj ją z ikony.",
      default: "Powiadomienia są wyłączone.",
      granted: "Powiadomienia są włączone.",
      denied: "Powiadomienia są zablokowane w ustawieniach przeglądarki lub systemu.",
    }[st];
    el.className = "msg" + (st === "granted" ? " ok" : st === "denied" ? " bad" : "");
  }
  if (ac) {
    ac.innerHTML =
      st === "default"
        ? '<button type="button" class="btn pri" data-sh="notif">Włącz powiadomienia</button>'
        : st === "granted"
        ? '<button type="button" class="btn" data-sh="ntest">Wyślij powiadomienie testowe</button>'
        : "";
  }
  renderPushState();
}

/* Diagnostyka serwera powiadomień (odczyt push-state.json i push-subscriptions.json z gałęzi push-state) */
export async function renderPushDiag() {
  const el = $("pushDiag");
  if (!el) return;
  if (!cfg.token) {
    el.textContent = "";
    return;
  }
  el.textContent = "Sprawdzam status serwera powiadomień…";
  el.className = "hint";
  try {
    const [stRes, subRes] = await Promise.all([
      ghFile(PUSH_STATE_FILE, "GET", null, PUSH_BRANCH),
      ghFile(PUSH_FILE, "GET", null, PUSH_BRANCH),
    ]);
    if (!$("pushDiag")) return;
    let hbText = "brak danych";
    let stale = false;
    if (stRes.ok) {
      const o = await stRes.json();
      const st = JSON.parse(b64d(o.content || ""));
      if (st && st.hb) {
        const d = new Date(st.hb);
        if (!Number.isNaN(d.getTime())) {
          const td = day0(new Date());
          const yest = new Date(td.getFullYear(), td.getMonth(), td.getDate() - 1);
          const dayStr = same(d, td) ? "dziś" : same(d, yest) ? "wczoraj" : dl(d);
          hbText = dayStr + " o " + fmtT(hm(d));
          stale = Date.now() - d.getTime() > 90 * 60 * 1000;
        }
      }
    }
    let devCount = null;
    if (subRes.ok) {
      const o = await subRes.json();
      const arr = JSON.parse(b64d(o.content || ""));
      if (Array.isArray(arr)) devCount = arr.length;
    }
    const parts = ["Ostatnie sprawdzenie: " + hbText];
    if (devCount !== null) parts.push("zapisanych urządzeń: " + devCount);
    el.textContent = "Serwer powiadomień · " + parts.join(" · ");
    el.className = stale ? "msg warn" : "hint";
  } catch (e) {
    if ($("pushDiag")) el.textContent = "";
  }
}
