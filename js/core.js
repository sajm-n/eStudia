/* ===== Rdzeń aplikacji: model danych, walidacja, kalendarz A/B i reguły powiadomień =====
   Czysty moduł ES bez zależności od DOM i localStorage — importowany zarówno przez przeglądarkę,
   jak i bezpośrednio przez scripts/notify.mjs oraz testy jednostkowe. */

import { TYPES, DEFAULT_TYPE_COLORS, TYPE_ORDER, TASK_TYPES, NOTIF_DEF, REM_MAX_MIN, OVERDUE_MS } from "./config.js";

export const isHexColor = (v) => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v.trim());

/* Scalony słownik typów zajęć: wbudowane TYPES + nadpisania i własne typy z plan.types */
export function planTypesOf(plan) {
  const out = {};
  for (const k of Object.keys(TYPES)) {
    out[k] = { label: TYPES[k], color: DEFAULT_TYPE_COLORS[k] || "#4b5363" };
  }
  const custom = plan && plan.types && typeof plan.types === "object" && !Array.isArray(plan.types) ? plan.types : null;
  if (custom) {
    for (const [k, v] of Object.entries(custom)) {
      if (!v || typeof v !== "object") continue;
      const lbl = typeof v.label === "string" ? v.label.trim().slice(0, 40) : "";
      const col = isHexColor(v.color) ? v.color.trim().toLowerCase() : (out[k] ? out[k].color : "#4b5363");
      if (lbl) out[k] = { label: lbl, color: col };
    }
  }
  return out;
}

export function typeLabel(plan, code) {
  const map = planTypesOf(plan);
  return (map[code] && map[code].label) || TYPES[code] || String(code || "");
}

export function typeColor(plan, code) {
  const map = planTypesOf(plan);
  return (map[code] && map[code].color) || DEFAULT_TYPE_COLORS[code] || "#4b5363";
}

export function typeTextColor(hex) {
  if (!isHexColor(hex)) return "#f3f5fa";
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 0.52 ? "#10151f" : "#f3f5fa";
}

export function typeOrderIndex(code) {
  const i = TYPE_ORDER.indexOf(code);
  return i >= 0 ? i : 3.5; /* własne typy pojawiają się przed "Inne" (x = 4) */
}

export function typePairsOf(plan) {
  const map = planTypesOf(plan);
  return Object.keys(map)
    .sort((a, b) => typeOrderIndex(a) - typeOrderIndex(b) || a.localeCompare(b, "pl"))
    .map((k) => [k, k === "x" && map[k].label === "Inne" ? "Inne (bez kategorii)" : map[k].label]);
}

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
export const ruleOf = (t, notif) =>
  (t && t.rem) ||
  (notif && (notif.task || (t && t.kind && notif[t.kind]) || notif.onsite || notif.online)) ||
  NOTIF_DEF.task;

export function taskTrigger(t, notif) {
  if (!t.due) return null;
  const d = fromDK(t.due);
  if (!d) return null;
  const p = (t.time || "23:59").split(":").map(Number);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), p[0], p[1]);
  let start = ruleStart(ruleOf(t, notif), d, end);
  if (start > end) start = end; /* powiadomienie nie może przyjść po terminie */
  return { start, end };
}

/* Moment zakończenia kolokwium/sesji: koniec zajęć z planu (jeśli przypada w ich trakcie), w przeciwnym razie godzina lub 23:59 */
export function examEndOf(plan, t) {
  if (!t || !t.due) return null;
  if (plan) {
    const cls = classForTask(plan, t);
    if (cls && cls.c && cls.c.e) return endOf(t.due, cls.c.e);
  }
  return endOf(t.due, t.time || "23:59");
}

/* Czy zadanie jest ukończone? Kolokwia i sesje kończą się automatycznie po swoim odbyciu (bez ręcznego oznaczania). */
export function isTaskDone(t, now = new Date(), plan = null) {
  if (!t) return false;
  if (isExamTask(t)) {
    const end = examEndOf(plan, t);
    return !!end && now >= end;
  }
  return t.done === true;
}

export function taskAlert(t, now, notif, plan = null) {
  if (isTaskDone(t, now, plan)) return null;
  const w = taskTrigger(t, notif);
  if (!w) return null;
  if (t.at && w.start.getTime() < t.at) return null;
  if (now < w.start) return null;
  if (now <= w.end) return "soon";
  if (isExamTask(t)) return null; /* kolokwia i sesje nie generują alertu „po terminie” */
  return now - w.end <= OVERDUE_MS ? "over" : null;
}

export function isLate(t, now = new Date(), plan = null) {
  if (!t || isExamTask(t) || t.done || !t.due) return false;
  const end = endOf(t.due, t.time || "23:59");
  return !!end && end < now;
}

/* Grupowanie zadań wg ruchomego horyzontu (bez ucinania na niedzieli) */
export function taskGroup(t, now = new Date(), plan = null) {
  if (isTaskDone(t, now, plan)) return "done";
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
  if (c === "exam" || c === "session") return true;
  if (c !== "task") return false;
  return /\b(kolos\w*|kolokwi\w*|egzamin\w*|sesj\w*)\b/i.test(String(t && t.text ? t.text : ""));
}

/* Nazwa przedmiotu przypisanego do zadania (przez sid lub starsze powiązanie cid) */
export function taskSubjectName(plan, t) {
  if (!plan || !t) return "";
  if (t.sid) {
    const s = (plan.subjects || []).find((x) => x.id === t.sid);
    if (s && s.name) return s.name;
  }
  if (t.cid) {
    const c = (plan.classes || []).find((x) => x.id === t.cid);
    if (c && c.name) return c.name;
  }
  return "";
}

/* Tytuł wyświetlany dla zadania (kolokwium i sprawozdanie mogą nie mieć nazwy) */
export function taskTitle(t) {
  if (!t) return "Zadanie";
  const tx = typeof t.text === "string" ? t.text.trim() : "";
  if (tx) return tx;
  const c = taskCat(t);
  if (c === "exam") return "Kolokwium";
  if (c === "session") return "Sesja";
  if (c === "report") return "Sprawozdanie";
  if (c === "project") return "Projekt";
  return "Zadanie";
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
  const okTypeCode = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,20}$/.test(v);

  /* Opcjonalny słownik typów zajęć w plan.json: { code: { label, color } } */
  const validatedTypes = {};
  const allowedTypes = new Set(Object.keys(TYPES));
  if (raw.types !== undefined && raw.types !== null) {
    if (typeof raw.types !== "object" || Array.isArray(raw.types)) {
      return bad("Nieprawidłowy słownik typów zajęć (types).");
    }
    const entries = Object.entries(raw.types).slice(0, 30);
    for (const [code, def] of entries) {
      if (!okTypeCode(code) || !def || typeof def !== "object") {
        return bad("Nieprawidłowy kod lub definicja typu zajęć: „" + code + "”.");
      }
      const label = str(def.label, 40);
      if (!label) return bad("Typ zajęć „" + code + "” nie ma nazwy.");
      if (!isHexColor(def.color)) return bad("Typ zajęć „" + code + "” ma nieprawidłowy kolor (wymagany #RRGGBB).");
      validatedTypes[code] = { label, color: def.color.trim().toLowerCase() };
      allowedTypes.add(code);
    }
  }

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
    if (!allowedTypes.has(c.type)) {
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
    if (c.manual === true) o.manual = true;
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
      if (x.toDate !== undefined && x.toDate !== null && x.toDate !== "" && x.toDate !== x.date && fromDK(x.toDate)) {
        e.toDate = x.toDate;
        any = true;
      }
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
    /* forms: osobne wymagania i informacje dla każdej formy zajęć (klucze jak w allowedTypes); mac: zgodność z MacBookiem */
    const forms = {};
    if (x.forms && typeof x.forms === "object" && !Array.isArray(x.forms)) {
      for (const k of allowedTypes) {
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

  /* Zadania niezależne od zajęć; powiązania z przedmiotem (sid) i zajęciami (cid) są opcjonalne.
     Dla kolokwium (exam) i sprawozdania (report) nazwa (text) może być pusta — kluczowy jest opis (note). */
  const tids = new Set();
  const tasks = [];
  for (const x of tks) {
    if (!x || typeof x !== "object") continue;
    const cat =
      typeof x.cat === "string" && x.cat !== "task" && Object.prototype.hasOwnProperty.call(TASK_TYPES, x.cat)
        ? x.cat
        : "";
    const text = str(x.text, 300);
    if (!text && cat !== "exam" && cat !== "session" && cat !== "report") continue;
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
    const u = str(x.url, 300);
    if (/^https?:\/\/\S+$/i.test(u)) t.url = u;
    const rem = normRule(x.rem, true);
    if (rem) t.rem = rem; /* własny termin powiadomienia; brak = reguła domyślna z ustawień */
    if (cat) t.cat = cat;
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
    const cat =
      typeof x.cat === "string" && x.cat !== "task" && Object.prototype.hasOwnProperty.call(TASK_TYPES, x.cat)
        ? x.cat
        : "";
    const text = str(x.text, 300);
    if (!text && cat !== "exam" && cat !== "session" && cat !== "report") continue;
    let id = okId(x.id) ? x.id : uid();
    while (atids.has(id)) id = uid();
    atids.add(id);
    const t = {
      id,
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
    const u = str(x.url, 300);
    if (/^https?:\/\/\S+$/i.test(u)) t.url = u;
    if (cat) t.cat = cat;
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

  /* Nadpisania całych dni: przeniesienie planu z innego dnia (fromDate), zamiana dni (swap) lub dzień wolny (off) */
  const dovRaw = Array.isArray(raw.dayOverrides) ? raw.dayOverrides.slice(0, 500) : [];
  const dovByDate = new Map();
  for (const x of dovRaw) {
    if (!x || typeof x !== "object" || !fromDK(x.date)) continue;
    const o = { date: x.date };
    if (x.off === true) {
      o.off = true;
      if (typeof x.toDate === "string" && x.toDate !== x.date && fromDK(x.toDate)) o.toDate = x.toDate;
    } else if (typeof x.fromDate === "string" && x.fromDate !== x.date && fromDK(x.fromDate)) {
      o.fromDate = x.fromDate;
    } else {
      continue;
    }
    const note = str(x.note, 120);
    if (note) o.note = note;
    dovByDate.set(x.date, o);
  }
  const dayOverrides = [...dovByDate.values()].sort((a, b) => a.date.localeCompare(b.date));

  /* Domyślny termin powiadomień o zadaniach (z zachowaniem zgodności wstecznej kluczy onsite/online) + poranny skrót dnia */
  const rn = raw.notif && typeof raw.notif === "object" ? raw.notif : {};
  const defRule = normRule(rn.task) || normRule(rn.onsite) || normRule(rn.online) || clone(NOTIF_DEF.task);
  const rm = rn.morning && typeof rn.morning === "object" ? rn.morning : null;
  const morningTime = rm && rm.time && normT(rm.time) ? normT(rm.time) : "07:30";
  const notif = {
    task: defRule,
    onsite: normRule(rn.onsite) || clone(defRule),
    online: normRule(rn.online) || clone(defRule),
    morning: { on: !!(rm && rm.on === true), time: morningTime },
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
  if (Object.keys(validatedTypes).length) outPlan.types = validatedTypes;
  if (absences.length) outPlan.absences = absences;
  if (Object.keys(absLimits).length) outPlan.absLimits = absLimits;
  if (archivedTasks.length) outPlan.archivedTasks = archivedTasks;
  if (semesters.length) outPlan.semesters = semesters;
  if (dayOverrides.length) outPlan.dayOverrides = dayOverrides;

  return { ok: true, plan: outPlan };
}

/* ----- Nadpisania całych dni (przeniesienie / zamiana / dzień wolny) ----- */
export function dayOverrideOf(plan, dateKey) {
  const list = Array.isArray(plan && plan.dayOverrides) ? plan.dayOverrides : [];
  return list.find((x) => x.date === dateKey) || null;
}

/* Zwraca powiązaną datę (do przeskoku po kliknięciu w etykietę przeniesienia dnia) albo null */
export function dayOverrideTarget(plan, dateKey) {
  const ov = dayOverrideOf(plan, dateKey);
  if (!ov) return null;
  if (ov.fromDate) return ov.fromDate;
  if (ov.toDate) return ov.toDate;
  if (ov.off) {
    const list = Array.isArray(plan && plan.dayOverrides) ? plan.dayOverrides : [];
    const paired = list.find((x) => x.fromDate === dateKey);
    if (paired) return paired.date;
  }
  return null;
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

/* Domyślny limit nieobecności: 2 dla laboratoriów, ćwiczeń i projektów; null (brak limitu) dla wykładów/innych, chyba że ustawiono własny */
export function absenceLimit(plan, cls) {
  if (!cls) return null;
  const lims = plan && plan.absLimits;
  if (lims && Object.prototype.hasOwnProperty.call(lims, cls.id)) {
    return lims[cls.id] > 0 ? lims[cls.id] : null;
  }
  return cls.type === "l" || cls.type === "c" || cls.type === "p" ? 2 : null;
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
  const ov = dayOverrideOf(plan, key);
  const out = [];

  /* 1. Zajęcia z tego dnia (albo z dnia źródłowego przy dayOverride.fromDate; brak przy dayOverride.off) */
  if (!(ov && ov.off)) {
    const srcDate = ov && ov.fromDate ? fromDK(ov.fromDate) || d : d;
    const srcKey = dk(srcDate);
    const w = weekOf(plan, srcDate);
    const dw = wd(srcDate);
    for (const c of plan.classes) {
      const ok = c.date ? c.date === srcKey : c.wd === dw && (c.weeks === "all" || c.weeks === w);
      if (!ok) continue;
      const ex = plan.exceptions.find((x) => x.cid === c.id && x.date === srcKey) || null;
      if (ex && ex.toDate) continue; /* przeniesione jednorazowo na inny dzień */
      const eff = Object.assign({}, c);
      if (ex && !ex.off) {
        for (const k of ["s", "e", "room", "person"]) {
          if (ex[k] !== undefined) eff[k] = ex[k];
        }
      }
      out.push({
        id: c.id,
        date: key,
        origDate: srcKey,
        c: eff,
        base: c,
        ex,
        off: !!(ex && ex.off),
        fromDay: ov && ov.fromDate ? ov.fromDate : "",
      });
    }
  }

  /* 2. Zajęcia przeniesione jednorazowo NA ten dzień (exceptions z toDate === key) */
  for (const ex of plan.exceptions) {
    if (ex.toDate !== key) continue;
    const c = plan.classes.find((x) => x.id === ex.cid);
    if (!c) continue;
    const eff = Object.assign({}, c);
    for (const k of ["s", "e", "room", "person"]) {
      if (ex[k] !== undefined) eff[k] = ex[k];
    }
    out.push({
      id: c.id,
      date: key,
      origDate: ex.date,
      c: eff,
      base: c,
      ex,
      off: false,
      movedFrom: ex.date,
    });
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

/* Najbliższe (od podanego dnia włącznie) nieodwołane zajęcia danego przedmiotu: {date, dk, s, e, cid} albo null.
   Opcjonalnie zawęża szukanie do tego samego typu zajęć (np. laboratorium → kolejne laboratorium, nie wykład). */
export function nextOccurrenceBySubject(plan, subjectName, fromDate = new Date(), opts = {}) {
  const target = String(subjectName || "").trim().toLowerCase();
  if (!target || !plan || !Array.isArray(plan.classes)) return null;
  const wantType = opts && opts.type ? opts.type : "";
  const wantCid = opts && opts.cid ? opts.cid : "";
  const startDay = day0(fromDate);
  const nowMin = fromDate.getHours() * 60 + fromDate.getMinutes();
  const findWith = (pred) => {
    for (let i = 0; i <= 190; i++) {
      const d = new Date(startDay.getFullYear(), startDay.getMonth(), startDay.getDate() + i);
      const list = itemsFor(plan, d);
      for (const it of list) {
        if (it.off) continue;
        if (String(it.c.name || "").trim().toLowerCase() !== target) continue;
        if (pred && !pred(it)) continue;
        if (i === 0 && mn(it.c.e) <= nowMin) continue;
        return { date: d, dk: dk(d), s: it.c.s, e: it.c.e, cid: it.id, type: it.c.type };
      }
    }
    return null;
  };
  if (wantCid) {
    const exact = findWith((it) => it.id === wantCid);
    if (exact) return exact;
  }
  if (wantType) {
    const byType = findWith((it) => it.c.type === wantType);
    if (byType) return byType;
  }
  return findWith(null);
}

/* Sprawdza, czy niezależne zadanie przypada w czasie trwania konkretnych zajęć */
export function taskMatchesClass(plan, t, item) {
  if (!plan || !t || !item || !item.c) return false;
  const date = item.date;
  const cid = item.id;
  const c = item.c;
  /* Starsze zadania bez daty, ale z jawnie podpiętym cid */
  if (!t.due) return !!(t.cid && t.cid === cid && (!t.date || t.date === date));
  if (t.due !== date) return false;

  const clsName = String(c.name || "").trim().toLowerCase();
  const taskSubj = taskSubjectName(plan, t).trim().toLowerCase();

  /* Dopasowanie po czasie trwania zajęć (główny mechanizm v2.6) */
  if (t.time) {
    const tm = mn(t.time);
    const s = mn(c.s);
    const e = mn(c.e);
    if (tm >= s && tm <= e) {
      /* Jeśli zadanie ma określony przedmiot, musi pasować do nazwy zajęć */
      if (!taskSubj || taskSubj === clsName) return true;
    }
    return false;
  }

  /* Zadanie bez godziny nie przypina się automatycznie do zajęć, chyba że było jawnie podpięte pod cid w tym dniu */
  return !!(t.cid && t.cid === cid && (!t.date || t.date === date));
}

/* Wszystkie zadania przypadające w czasie trwania danej pozycji zajęć (item = element z itemsFor) */
export function tasksForClass(plan, item, now = new Date()) {
  if (!plan || !Array.isArray(plan.tasks) || !item) return [];
  return plan.tasks
    .filter((t) => taskMatchesClass(plan, t, item))
    .sort(
      (a, b) =>
        isTaskDone(a, now, plan) - isTaskDone(b, now, plan) ||
        (a.due ? a.due + (a.time || "23:59") : "9").localeCompare(b.due ? b.due + (b.time || "23:59") : "9")
    );
}

/* Znajduje zajęcia z planu, w czasie których przypada dane zadanie (albo null) */
export function classForTask(plan, t) {
  if (!plan || !t || !t.due) return null;
  const d = fromDK(t.due);
  if (!d) return null;
  const list = itemsFor(plan, d);
  return list.find((it) => !it.off && taskMatchesClass(plan, t, it)) || list.find((it) => taskMatchesClass(plan, t, it)) || null;
}

/* Poranny skrót dnia dla powiadomienia push: { title, body } albo null, jeśli dzień jest wolny i bez zadań */
export function morningSummary(plan, dateObj = new Date()) {
  if (!plan) return null;
  const d = day0(dateObj);
  const dKey = dk(d);
  const cls = itemsFor(plan, d).filter((x) => !x.off);
  const dueToday = (plan.tasks || []).filter((t) => !isTaskDone(t, dateObj, plan) && t.due === dKey);
  if (!cls.length && !dueToday.length) return null;

  const parts = [];
  if (cls.length) {
    const first = cls[0].c;
    const wCls = cls.length === 1 ? "1 zajęcia" : cls.length + " zajęć";
    parts.push(wCls + " (start " + fmtT(first.s) + (first.room ? ", " + first.room : "") + ")");
  }
  const sessions = dueToday.filter((t) => taskCat(t) === "session").length;
  const exams = dueToday.filter((t) => isExamTask(t) && taskCat(t) !== "session").length;
  const other = dueToday.length - sessions - exams;
  if (sessions) parts.push(sessions === 1 ? "1 sesja" : sessions >= 2 && sessions <= 4 ? sessions + " sesje" : sessions + " sesji");
  if (exams) parts.push(exams === 1 ? "1 kolokwium" : exams + " kolokwia");
  if (other) parts.push(other === 1 ? "1 zadanie" : other >= 2 && other <= 4 ? other + " zadania" : other + " zadań");

  const wdShort = d.toLocaleDateString("pl-PL", { weekday: "short" });
  return {
    title: "Plan na dziś (" + wdShort + ")",
    body: parts.join(" · "),
  };
}

/* Czy zajęcia/wydarzenie zostało dodane ręcznie w aplikacji (flaga manual lub historyczne ID z uid() postaci k...) */
export const isManualClass = (c) =>
  !!(c && (c.manual === true || /^k[0-9a-z]{6,}$/.test(String(c.id || ""))));

/* Aktualizacja samego planu zajęć z nowego pliku JSON (np. po zmianie sal w eStudiaTools):
   podmienia zajęcia z planu i definicje typów/kolorów, mapuje stare ID zajęć na nowe (1-do-1),
   dopisuje i zachowuje ręcznie dodane zajęcia/wydarzenia (cykliczne i jednorazowe),
   a także zachowuje zadania, przedmioty/notatki, nieobecności, limity, wyjątki, rytm A/B,
   nadpisania dni, powiadomienia oraz archiwum semestrów. */
export function mergeSchedule(currentPlan, importedPlan) {
  const curV = validatePlan(currentPlan);
  if (!curV.ok) return { ok: false, error: curV.error };
  const incV = validatePlan(importedPlan);
  if (!incV.ok) return { ok: false, error: incV.error };

  const cur = curV.plan;
  const inc = incV.plan;
  const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

  const oldClasses = cur.classes || [];
  const newClasses = clone(inc.classes || []);
  const incomingHasOneOff = newClasses.some((c) => !!c.date);

  /* Dopasowanie 1-do-1 między starymi i nowymi zajęciami (zachowuje powiązania nawet po przesunięciu ID c01/c02…) */
  const candidates = [];
  for (let oi = 0; oi < oldClasses.length; oi++) {
    const oc = oldClasses[oi];
    const oName = norm(oc.name);
    for (let ni = 0; ni < newClasses.length; ni++) {
      const nc = newClasses[ni];
      if (oc.type !== nc.type || oName !== norm(nc.name)) continue;
      let score = 0;
      if (!oc.date && !nc.date) {
        score = 10;
        if (oc.wd === nc.wd) score += 40;
        if (oc.weeks === nc.weeks) score += 20;
        if (oc.s === nc.s && oc.e === nc.e) score += 25;
        else if (oc.s === nc.s) score += 15;
        if (oc.person && nc.person && norm(oc.person) === norm(nc.person)) score += 10;
        if (oc.room && nc.room && norm(oc.room) === norm(nc.room)) score += 5;
        if (oc.id === nc.id) score += 3;
      } else if (oc.date && nc.date && oc.date === nc.date) {
        score = 80;
        if (oc.s === nc.s && oc.e === nc.e) score += 20;
        else if (oc.s === nc.s) score += 10;
        if (oc.id === nc.id) score += 3;
      } else {
        continue;
      }
      candidates.push({ oi, ni, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.oi - b.oi || a.ni - b.ni);

  const matchedOld = new Set();
  const matchedNew = new Set();
  const cidMap = new Map();
  const updated = [];

  for (const cand of candidates) {
    if (matchedOld.has(cand.oi) || matchedNew.has(cand.ni)) continue;
    matchedOld.add(cand.oi);
    matchedNew.add(cand.ni);
    const oc = oldClasses[cand.oi];
    const nc = newClasses[cand.ni];
    cidMap.set(oc.id, nc.id);

    const diffs = [];
    if (oc.wd !== nc.wd || oc.weeks !== nc.weeks || oc.s !== nc.s || oc.e !== nc.e) diffs.push("time");
    if (norm(oc.room) !== norm(nc.room)) diffs.push("room");
    if (norm(oc.person) !== norm(nc.person)) diffs.push("person");
    if (diffs.length) updated.push({ old: clone(oc), next: clone(nc), diffs });
  }

  /* Dopisz ręcznie dodane zajęcia/wydarzenia (cykliczne i jednorazowe) oraz jednorazowe z obecnego planu,
     jeśli importowany plik ich nie zawiera — bez usuwania przy aktualizacji planu z PDF */
  const usedIds = new Set(newClasses.map((c) => c.id));
  const preservedIdx = new Set();
  const keptManual = [];
  let keptOneOff = 0;
  for (let oi = 0; oi < oldClasses.length; oi++) {
    if (matchedOld.has(oi)) continue;
    const oc = oldClasses[oi];
    const manual = isManualClass(oc);
    const keepOneOff = !incomingHasOneOff && !!oc.date;
    if (!manual && !keepOneOff) continue;
    const copy = clone(oc);
    if (manual) copy.manual = true;
    if (usedIds.has(copy.id)) {
      let nextId = uid();
      while (usedIds.has(nextId)) nextId = uid();
      copy.id = nextId;
    }
    usedIds.add(copy.id);
    cidMap.set(oc.id, copy.id);
    newClasses.push(copy);
    preservedIdx.add(oi);
    keptManual.push(clone(copy));
    if (copy.date) keptOneOff++;
  }

  const added = [];
  for (let ni = 0; ni < inc.classes.length; ni++) {
    if (!matchedNew.has(ni)) added.push(clone(inc.classes[ni]));
  }
  const removed = [];
  for (let oi = 0; oi < oldClasses.length; oi++) {
    if (!matchedOld.has(oi) && !preservedIdx.has(oi)) removed.push(clone(oldClasses[oi]));
  }

  /* Definicje typów: nowe z importu + ewentualne zachowane dla istniejących form przedmiotów lub ręcznych zajęć */
  let mergedTypes;
  if (inc.types) {
    mergedTypes = clone(inc.types);
    if (cur.types) {
      const needed = new Set();
      for (const c of newClasses) needed.add(c.type);
      for (const s of cur.subjects || []) {
        if (s.forms && typeof s.forms === "object") {
          for (const k of Object.keys(s.forms)) needed.add(k);
        }
      }
      for (const k of needed) {
        if (!mergedTypes[k] && cur.types[k]) mergedTypes[k] = clone(cur.types[k]);
      }
    }
  } else if (cur.types) {
    mergedTypes = clone(cur.types);
  }

  /* Przedmioty: zachowaj wszystkie obecne; z importu dołącz tylko nowe, które mają realną treść */
  const subjects = clone(cur.subjects || []);
  const curSubjNames = new Set(subjects.map((s) => norm(s.name)));
  const curSubjIds = new Set(subjects.map((s) => s.id));
  for (const s of inc.subjects || []) {
    const k = norm(s.name);
    if (!k || curSubjNames.has(k)) continue;
    const hasContent = !!(s.desc || s.req || s.mac || (s.forms && Object.keys(s.forms).length));
    if (!hasContent) continue;
    const copy = clone(s);
    if (curSubjIds.has(copy.id)) {
      let nextId = uid();
      while (curSubjIds.has(nextId)) nextId = uid();
      copy.id = nextId;
    }
    curSubjIds.add(copy.id);
    curSubjNames.add(k);
    subjects.push(copy);
  }

  const remapCid = (cid) => (cid && cidMap.has(cid) ? cidMap.get(cid) : "");

  const exceptions = [];
  for (const ex of cur.exceptions || []) {
    const newCid = remapCid(ex.cid);
    if (!newCid) continue;
    exceptions.push(Object.assign(clone(ex), { cid: newCid }));
  }

  const absences = [];
  for (const a of cur.absences || []) {
    const newCid = remapCid(a.cid);
    if (!newCid) continue;
    absences.push({ cid: newCid, date: a.date });
  }

  const absLimits = {};
  if (cur.absLimits) {
    for (const [cid, lim] of Object.entries(cur.absLimits)) {
      const newCid = remapCid(cid);
      if (newCid) absLimits[newCid] = lim;
    }
  }

  const tasks = (cur.tasks || []).map((t) => {
    const copy = clone(t);
    if (copy.cid) copy.cid = remapCid(copy.cid);
    return copy;
  });

  const archivedTasks = (cur.archivedTasks || []).map((t) => {
    const copy = clone(t);
    if (copy.cid) copy.cid = remapCid(copy.cid);
    return copy;
  });

  const mergedRaw = {
    v: 1,
    rev: cur.rev,
    start: cur.start,
    startWeek: cur.startWeek,
    classes: newClasses,
    exceptions,
    subjects,
    tasks,
    notif: clone(cur.notif),
  };
  if (cur.semester || inc.semester) mergedRaw.semester = cur.semester || inc.semester;
  if (mergedTypes && Object.keys(mergedTypes).length) mergedRaw.types = mergedTypes;
  if (absences.length) mergedRaw.absences = absences;
  if (Object.keys(absLimits).length) mergedRaw.absLimits = absLimits;
  if (archivedTasks.length) mergedRaw.archivedTasks = archivedTasks;
  if (cur.semesters && cur.semesters.length) mergedRaw.semesters = clone(cur.semesters);
  if (cur.dayOverrides && cur.dayOverrides.length) mergedRaw.dayOverrides = clone(cur.dayOverrides);

  const out = validatePlan(mergedRaw);
  if (!out.ok) return out;

  const typesChanged = JSON.stringify(planTypesOf(cur)) !== JSON.stringify(planTypesOf(out.plan));
  return {
    ok: true,
    plan: out.plan,
    stats: {
      matched: matchedNew.size,
      updated,
      added,
      removed,
      keptManual,
      keptOneOff,
      typesChanged,
      totalClasses: out.plan.classes.length,
    },
  };
}


