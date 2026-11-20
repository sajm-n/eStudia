/* ===== Rdzeń aplikacji: model danych, walidacja, kalendarz A/B i reguły powiadomień =====
   Czysty moduł ES bez zależności od DOM i localStorage — importowany zarówno przez przeglądarkę,
   jak i bezpośrednio przez scripts/notify.mjs oraz testy jednostkowe. */

import { TYPES, TASK_TYPES, NOTIF_DEF, REM_MAX_MIN, OVERDUE_MS } from "./config.js";

export const pad = (n) => String(n).padStart(2, "0");
export const day0 = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const wd = (d) => (d.getDay() + 6) % 7;
export const same = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export const dk = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());

export const fromDK = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return dk(d) === s ? d : null;
};

export const normT = (t) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t == null ? "" : t).trim());
  if (!m) return null;
  const h = +m[1];
  const i = +m[2];
  return h < 24 && i < 60 ? pad(h) + ":" + pad(i) : null;
};

export const mn = (t) => {
  const a = t.split(":");
  return +a[0] * 60 + +a[1];
};

export const fmtT = (t) => t.replace(/^0/, "");
export const clone = (o) => JSON.parse(JSON.stringify(o));
export const uid = () => "k" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const mondayOf = (d) => {
  const x = day0(d);
  x.setDate(x.getDate() - wd(x));
  return x;
};

export function endOf(due, time) {
  const d = fromDK(due);
  const tm = normT(time);
  return d && tm
    ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), +tm.slice(0, 2), +tm.slice(3, 5))
    : null;
}

/* ===== Przypomnienia o nieukończonych zadaniach =====
   Termin powiadomienia opisuje reguła:
     {m:"rel",min:N}                 N minut przed terminem zadania,
     {m:"day",days:N,time:"GG:MM"}   N dni przed dniem terminu, o stałej godzinie (tylko w ustawieniach domyślnych),
     {m:"abs",at:"RRRR-MM-DDTGG:MM"} konkretna data i godzina (tylko w zadaniu).
   Zadanie bez własnej reguły (pole rem) używa reguły domyślnej z ustawień (plan.notif) dla swojego rodzaju.
   Wartości startowe: stacjonarne = dzień przed terminem (dniem zajęć) o 18:00, online = dokładnie 24 h przed terminem.
   Przypomnienie dotyczy tylko zadań, które istniały w chwili jego wyzwolenia (pole at = czas utworzenia),
   więc zadanie dodane już po tej chwili nie alarmuje od razu. */

export function normRule(x, task) {
  if (!x || typeof x !== "object") return null;
  if (x.m === "rel") {
    const n = Math.round(+x.min);
    return Number.isFinite(n) && n >= 1 && n <= REM_MAX_MIN ? { m: "rel", min: n } : null;
  }
  if (x.m === "day" && !task) {
    const n = Math.round(+x.days);
    const tm = normT(x.time);
    return Number.isFinite(n) && n >= 0 && n <= 60 && tm ? { m: "day", days: n, time: tm } : null;
  }
  if (x.m === "abs" && task) {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(String(x.at));
    if (m && fromDK(m[1]) && normT(m[2]) === m[2]) return { m: "abs", at: x.at };
  }
  return null;
}

export function ruleStart(r, d, end) {
  if (r.m === "rel") return new Date(end.getTime() - r.min * 6e4);
  if (r.m === "day") {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - r.days, +r.time.slice(0, 2), +r.time.slice(3, 5));
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(r.at);
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}

/* Reguła obowiązująca dla zadania: własna albo domyślna z ustawień */
export const ruleOf = (t, notif) => t.rem || (notif && notif[t.kind]) || NOTIF_DEF[t.kind];

export function taskTrigger(t, notif) {
  if (!t.due) return null;
  const d = fromDK(t.due);
  if (!d) return null;
  const p = (t.time || (t.kind === "online" ? "23:59" : "00:00")).split(":").map(Number);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), p[0], p[1]);
  let start = ruleStart(ruleOf(t, notif), d, end);
  if (start > end) start = end; /* powiadomienie nie może przyjść po terminie */
  return { start, end };
}

export function taskAlert(t, now, notif) {
  if (t.done) return null;
  const w = taskTrigger(t, notif);
  if (!w) return null;
  if (t.at && w.start.getTime() < t.at) return null;
  if (now < w.start) return null;
  if (now <= w.end) return "soon";
  return now - w.end <= OVERDUE_MS ? "over" : null;
}

export function isLate(t, now = new Date()) {
  if (t.done || !t.due) return false;
  const end = endOf(t.due, t.time || (t.kind === "online" ? "23:59" : "00:00"));
  return !!end && end < now;
}

/* Grupowanie zadań wg ruchomego horyzontu (bez ucinania na niedzieli) */
export function taskGroup(t, now = new Date()) {
  if (t.done) return "done";
  if (!t.due) return "later";
  const td = day0(now);
  const d = fromDK(t.due);
  if (!d) return "later";
  const diff = Math.round((d - td) / 864e5);
  if (diff < 0) return "over";
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === 2) return "afterTomorrow";
  if (diff <= 7) return "week";
  return "later";
}

export const taskCat = (t) => (t && Object.prototype.hasOwnProperty.call(TASK_TYPES, t.cat) ? t.cat : "task");

export function isExamTask(t) {
  const c = taskCat(t);
  if (c === "exam") return true;
  if (c !== "task") return false;
  return /\b(kolos\w*|kolokwi\w*|egzamin\w*)\b/i.test(String(t && t.text ? t.text : ""));
}

/* Walidacja i normalizacja planu (import, odpowiedź z GitHuba, każdy zapis) */
export function validatePlan(raw) {
  const bad = (m) => ({ ok: false, error: m });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return bad("To nie jest plik planu (oczekiwano obiektu JSON).");
  }
  if (raw.v !== 1) return bad("Nieobsługiwana wersja pliku planu.");
  if (!Array.isArray(raw.classes) || raw.classes.length > 500) {
    return bad("Brak listy zajęć albo jest zbyt długa.");
  }
  const exs = raw.exceptions === undefined ? [] : raw.exceptions;
  if (!Array.isArray(exs) || exs.length > 3000) return bad("Nieprawidłowa lista wyjątków.");
  const sbs = raw.subjects === undefined ? [] : raw.subjects;
  const tks = raw.tasks === undefined ? [] : raw.tasks;
  if (!Array.isArray(sbs) || sbs.length > 1000) return bad("Nieprawidłowa lista przedmiotów.");
  if (!Array.isArray(tks) || tks.length > 5000) return bad("Nieprawidłowa lista zadań.");
  if (!fromDK(raw.start)) return bad("Nieprawidłowa data startu rytmu A/B.");
  if (raw.startWeek !== "A" && raw.startWeek !== "B") {
    return bad("Tydzień startowy musi być równy A lub B.");
  }

  const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const ids = new Set();
  const classes = [];

  for (let i = 0; i < raw.classes.length; i++) {
    const c = raw.classes[i];
    const n = i + 1;
    if (!c || typeof c !== "object") return bad("Zajęcia nr " + n + ": nieprawidłowe dane.");
    const id = typeof c.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(c.id) ? c.id : null;
    if (!id || ids.has(id)) return bad("Zajęcia nr " + n + ": brak identyfikatora albo duplikat.");
    ids.add(id);
    const name = str(c.name, 120);
    if (!name) return bad("Zajęcia nr " + n + ": brak nazwy.");
    if (!Object.prototype.hasOwnProperty.call(TYPES, c.type)) {
      return bad("„" + name + "”: nieznany rodzaj zajęć.");
    }
    const s = normT(c.s);
    const e = normT(c.e);
    if (!s || !e || mn(s) >= mn(e)) {
      return bad("„" + name + "”: godzina zakończenia musi być późniejsza niż rozpoczęcia.");
    }
    const o = { id, name, type: c.type };
    if (c.date !== undefined && c.date !== null) {
      if (!fromDK(c.date)) return bad("„" + name + "”: nieprawidłowa data.");
      o.date = c.date;
    } else {
      if (!Number.isInteger(c.wd) || c.wd < 0 || c.wd > 6) {
        return bad("„" + name + "”: nieprawidłowy dzień tygodnia.");
      }
      if (c.weeks !== "all" && c.weeks !== "A" && c.weeks !== "B") {
        return bad("„" + name + "”: nieprawidłowa częstotliwość.");
      }
      o.wd = c.wd;
      o.weeks = c.weeks;
    }
    o.s = s;
    o.e = e;
    o.room = str(c.room, 80);
    o.person = str(c.person, 80);
    classes.push(o);
  }

  const byKey = new Map();
  for (const x of exs) {
    if (!x || typeof x !== "object" || typeof x.cid !== "string" || !ids.has(x.cid) || !fromDK(x.date)) {
      continue;
    }
    const e = {
      id: typeof x.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(x.id) ? x.id : uid(),
      cid: x.cid,
      date: x.date,
    };
    if (x.off === true) {
      e.off = true;
    } else {
      let any = false;
      if (x.s !== undefined) { const t = normT(x.s); if (t) { e.s = t; any = true; } }
      if (x.e !== undefined) { const t = normT(x.e); if (t) { e.e = t; any = true; } }
      if (x.room !== undefined && typeof x.room === "string") { e.room = str(x.room, 80); any = true; }
      if (x.person !== undefined && typeof x.person === "string") { e.person = str(x.person, 80); any = true; }
      if (!any) continue;
    }
    byKey.set(x.cid + "|" + x.date, e);
  }

  /* Przedmioty: opis i wymagania (osobno od planu zajęć) */
  const okId = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(v);
  const sids = new Set();
  const subjects = [];
  for (const x of sbs) {
    if (!x || typeof x !== "object") continue;
    const name = str(x.name, 120);
    if (!name) continue;
    let id = okId(x.id) ? x.id : uid();
    while (sids.has(id)) id = uid();
    sids.add(id);
    /* forms: osobne wymagania i informacje dla wykładu / laboratorium / ćwiczeń (klucze jak w TYPES); mac: zgodność z MacBookiem */
    const forms = {};
    if (x.forms && typeof x.forms === "object" && !Array.isArray(x.forms)) {
      for (const k of Object.keys(TYPES)) {
        const f = x.forms[k];
        if (!f || typeof f !== "object") continue;
        const req = str(f.req, 3000);
        const desc = str(f.desc, 3000);
        if (req || desc) forms[k] = { req, desc };
      }
    }
    subjects.push({
      id,
      name,
      desc: str(x.desc, 3000),
      req: str(x.req, 3000),
      forms,
      mac: ["yes", "part", "no"].includes(x.mac) ? x.mac : "",
    });
  }

  /* Zadania: "onsite" (stacjonarne) i "online"; powiązania z przedmiotem (sid) i zajęciami (cid) są opcjonalne */
  const tids = new Set();
  const tasks = [];
  for (const x of tks) {
    if (!x || typeof x !== "object") continue;
    const kind = x.kind === "online" ? "online" : x.kind === "onsite" ? "onsite" : null;
    if (!kind) continue;
    const text = str(x.text, 300);
    if (!text) continue;
    let due = "";
    if (x.due !== undefined && x.due !== null && x.due !== "") {
      if (!fromDK(x.due)) continue;
      due = x.due;
    }
    let id = okId(x.id) ? x.id : uid();
    while (tids.has(id)) id = uid();
    tids.add(id);
    const t = {
      id,
      kind,
      text,
      sid: sids.has(x.sid) ? x.sid : "",
      cid: ids.has(x.cid) ? x.cid : "",
      date: fromDK(x.date) ? x.date : "",
      due,
      time: "",
      url: "",
      at: Number.isFinite(x.at) && x.at > 0 ? Math.floor(x.at) : 0,
      note: str(x.note, 1000),
      done: x.done === true,
    };
    if (x.time) {
      const tm = normT(x.time);
      if (tm) t.time = tm;
    }
    if (kind === "online") {
      const u = str(x.url, 300);
      if (/^https?:\/\/\S+$/i.test(u)) t.url = u;
    }
    const rem = normRule(x.rem, true);
    if (rem) t.rem = rem; /* własny termin powiadomienia; brak = reguła domyślna z ustawień */
    if (typeof x.cat === "string" && x.cat !== "task" && Object.prototype.hasOwnProperty.call(TASK_TYPES, x.cat)) {
      t.cat = x.cat;
    }
    tasks.push(t);
  }

  /* Nieobecności na zajęciach (unikalne po cid|date) oraz opcjonalne limity na cid */
  const absRaw = Array.isArray(raw.absences) ? raw.absences.slice(0, 2000) : [];
  const absByKey = new Map();
  for (const x of absRaw) {
    if (!x || typeof x !== "object" || typeof x.cid !== "string" || !ids.has(x.cid) || !fromDK(x.date)) continue;
    absByKey.set(x.cid + "|" + x.date, { cid: x.cid, date: x.date });
  }
  const absences = [...absByKey.values()].sort((a, b) => a.date.localeCompare(b.date) || a.cid.localeCompare(b.cid));

  const absLimits = {};
  if (raw.absLimits && typeof raw.absLimits === "object" && !Array.isArray(raw.absLimits)) {
    for (const [cid, lim] of Object.entries(raw.absLimits)) {
      if (!ids.has(cid)) continue;
      const n = Math.round(+lim);
      if (Number.isInteger(n) && n >= 0 && n <= 30) absLimits[cid] = n;
    }
  }

  /* Zarchiwizowane ukończone zadania */
  const archRaw = Array.isArray(raw.archivedTasks) ? raw.archivedTasks.slice(0, 5000) : [];
  const archivedTasks = [];
  const atids = new Set();
  for (const x of archRaw) {
    if (!x || typeof x !== "object") continue;
    const kind = x.kind === "online" ? "online" : x.kind === "onsite" ? "onsite" : null;
    if (!kind) continue;
    const text = str(x.text, 300);
    if (!text) continue;
    let id = okId(x.id) ? x.id : uid();
    while (atids.has(id)) id = uid();
    atids.add(id);
    const t = {
      id,
      kind,
      text,
      sid: sids.has(x.sid) ? x.sid : "",
      cid: ids.has(x.cid) ? x.cid : "",
      date: fromDK(x.date) ? x.date : "",
      due: fromDK(x.due) ? x.due : "",
      time: x.time && normT(x.time) ? normT(x.time) : "",
      url: "",
      at: Number.isFinite(x.at) && x.at > 0 ? Math.floor(x.at) : 0,
      note: str(x.note, 1000),
      done: true,
    };
    if (typeof x.cat === "string" && x.cat !== "task" && Object.prototype.hasOwnProperty.call(TASK_TYPES, x.cat)) {
      t.cat = x.cat;
    }
    if (typeof x.label === "string" && x.label.trim()) t.label = str(x.label, 120);
    archivedTasks.push(t);
  }

  /* Nazwa bieżącego semestru i archiwum poprzednich semestrów */
  const semester = str(raw.semester, 60);
  const semRaw = Array.isArray(raw.semesters) ? raw.semesters.slice(0, 20) : [];
  const semesters = [];
  const semIds = new Set();
  for (const s of semRaw) {
    if (!s || typeof s !== "object" || !s.plan || typeof s.plan !== "object") continue;
    const name = str(s.name, 60);
    if (!name) continue;
    const sv = validatePlan(Object.assign({}, s.plan, { semesters: [] }));
    if (!sv.ok) continue;
    let id = okId(s.id) ? s.id : uid();
    while (semIds.has(id)) id = uid();
    semIds.add(id);
    const sp = sv.plan;
    delete sp.semesters;
    semesters.push({
      id,
      name,
      savedAt: Number.isFinite(s.savedAt) && s.savedAt > 0 ? Math.floor(s.savedAt) : Date.now(),
      plan: sp,
    });
  }

  /* Domyślne terminy powiadomień (osobno dla zadań stacjonarnych i online); brak lub błąd = wartości startowe */
  const rn = raw.notif && typeof raw.notif === "object" ? raw.notif : {};
  const notif = {
    onsite: normRule(rn.onsite) || clone(NOTIF_DEF.onsite),
    online: normRule(rn.online) || clone(NOTIF_DEF.online),
  };

  const outPlan = {
    v: 1,
    rev: Number.isFinite(raw.rev) ? raw.rev : 0,
    start: raw.start,
    startWeek: raw.startWeek,
    classes,
    exceptions: [...byKey.values()],
    subjects,
    tasks,
    notif,
  };
  if (semester) outPlan.semester = semester;
  if (absences.length) outPlan.absences = absences;
  if (Object.keys(absLimits).length) outPlan.absLimits = absLimits;
  if (archivedTasks.length) outPlan.archivedTasks = archivedTasks;
  if (semesters.length) outPlan.semesters = semesters;

  return { ok: true, plan: outPlan };
}

/* ----- Nieobecności na zajęciach ----- */
export function absencesOf(plan, cid) {
  const list = Array.isArray(plan && plan.absences) ? plan.absences : [];
  return list.filter((x) => x.cid === cid).map((x) => x.date);
}

export function isAbsentOn(plan, cid, date) {
  const list = Array.isArray(plan && plan.absences) ? plan.absences : [];
  return list.some((x) => x.cid === cid && x.date === date);
}

/* Domyślny limit nieobecności: 2 dla laboratoriów i ćwiczeń; null (brak limitu) dla wykładów/innych, chyba że ustawiono własny */
export function absenceLimit(plan, cls) {
  if (!cls) return null;
  const lims = plan && plan.absLimits;
  if (lims && Object.prototype.hasOwnProperty.call(lims, cls.id)) {
    return lims[cls.id] > 0 ? lims[cls.id] : null;
  }
  return cls.type === "l" || cls.type === "c" ? 2 : null;
}

export const serialize = (p) => JSON.stringify(p, null, 2) + "\n";

/* Tydzień A/B i zajęcia w danym dniu */
export function weekOf(plan, d) {
  const n = Math.round((mondayOf(d) - mondayOf(fromDK(plan.start))) / 6048e5);
  const odd = ((n % 2) + 2) % 2 === 1;
  return odd ? (plan.startWeek === "A" ? "B" : "A") : plan.startWeek;
}

export const isPre = (plan, d) => day0(d) < fromDK(plan.start);

export function itemsFor(plan, d) {
  const key = dk(d);
  const w = weekOf(plan, d);
  const dw = wd(d);
  const out = [];
  for (const c of plan.classes) {
    const ok = c.date ? c.date === key : c.wd === dw && (c.weeks === "all" || c.weeks === w);
    if (!ok) continue;
    const ex = plan.exceptions.find((x) => x.cid === c.id && x.date === key) || null;
    const eff = Object.assign({}, c);
    if (ex && !ex.off) {
      for (const k of ["s", "e", "room", "person"]) {
        if (ex[k] !== undefined) eff[k] = ex[k];
      }
    }
    out.push({ id: c.id, date: key, c: eff, base: c, ex, off: !!(ex && ex.off) });
  }
  out.sort((a, b) => mn(a.c.s) - mn(b.c.s) || mn(a.c.e) - mn(b.c.e));
  return out;
}

/* Ostrzeżenie o nakładaniu się zajęć (nie blokuje zapisu) */
export function overlaps(plan, cand, ignoreId) {
  const res = [];
  const s = mn(cand.s);
  const e = mn(cand.e);
  for (const c of plan.classes) {
    if (c.id === ignoreId) continue;
    if (!(s < mn(c.e) && mn(c.s) < e)) continue;
    let clash;
    if (cand.date && c.date) clash = cand.date === c.date;
    else if (cand.date) {
      const d = fromDK(cand.date);
      clash = c.wd === wd(d) && (c.weeks === "all" || c.weeks === weekOf(plan, d));
    } else if (c.date) {
      const d = fromDK(c.date);
      clash = cand.wd === wd(d) && (cand.weeks === "all" || cand.weeks === weekOf(plan, d));
    } else {
      clash = cand.wd === c.wd && (cand.weeks === "all" || c.weeks === "all" || cand.weeks === c.weeks);
    }
    if (clash) res.push(c);
  }
  return res;
}

/* Najbliższe (po podanym dniu) nieodwołane zajęcia danej pozycji planu: {date, s} albo null */
export function nextOccurrence(plan, cid, after) {
  if (!plan.classes.some((x) => x.id === cid)) return null;
  for (let i = 1; i <= 190; i++) {
    const d = new Date(after.getFullYear(), after.getMonth(), after.getDate() + i);
    const it = itemsFor(plan, d).find((x) => x.id === cid && !x.off);
    if (it) return { date: d, s: it.c.s };
  }
  return null;
}
