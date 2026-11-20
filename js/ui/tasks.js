/* ===== Centrum zadań (ujednolicone, niezależne od zajęć), filtry, typy oraz termin powiadomienia ===== */

import { GROUPS, MAC_TXT, TASK_TYPES, TASK_TYPE_PAIRS } from "../config.js";
import {
  day0,
  dk,
  fromDK,
  normT,
  fmtT,
  uid,
  endOf,
  ruleOf,
  ruleStart,
  isLate,
  taskGroup,
  taskCat,
  isExamTask,
  taskSubjectName,
  taskTitle,
  tasksForClass,
  classForTask,
  nextOccurrenceBySubject,
} from "../core.js";
import { cache } from "../sync.js";
import { $, esc, reduced, dlong, hm, fmtLocal, nameLc, selOpts, ui, app } from "../state.js";
import { openSheet, closeSheet, change, popCb } from "./sheet.js";
import { macOf } from "./subjects.js";

export function taskLabelOf(t) {
  return taskSubjectName(cache.plan, t);
}

/* Odznaka typu zadania (Kolokwium / Sprawozdanie / Projekt); domyślne „Zadanie” nie zaśmieca wiersza */
export function catChip(t) {
  const c = taskCat(t);
  const eff = c === "task" && isExamTask(t) ? "exam" : c;
  if (eff === "task") return "";
  return '<span class="tcat ' + eff + '">' + esc(TASK_TYPES[eff]) + "</span>";
}

/* Nagłówek wiersza zadania: dla kolokwium/sprawozdania bez nazwy pokazuje odznakę + przedmiot zamiast powielać słowo */
export function taskHeadingHtml(t, { omitSubj = false } = {}) {
  const tx = typeof t.text === "string" ? t.text.trim() : "";
  const chip = catChip(t);
  if (tx) return chip + esc(tx);
  const sub = omitSubj ? "" : taskLabelOf(t);
  if (sub) return chip + esc(sub);
  if (chip) return chip;
  return esc(taskTitle(t));
}

export function taskNoteHtml(t) {
  const n = typeof t.note === "string" ? t.note.trim() : "";
  return n ? '<span class="tk-note">' + esc(n) + "</span>" : "";
}

/* Kompaktowy wybór typu zadania (1 tapnięcie) używany w formularzach zadań */
export function catPickerHtml(cur = "task") {
  const val = Object.prototype.hasOwnProperty.call(TASK_TYPES, cur) ? cur : "task";
  return (
    '<div class="remb" data-catbox><span class="lbl">Typ</span>' +
    '<input type="hidden" name="cat" value="' +
    val +
    '"><div class="rchips tcats" role="group" aria-label="Typ zadania">' +
    TASK_TYPE_PAIRS.map(
      (o) =>
        '<button type="button" data-tcat="' +
        o[0] +
        '" class="' +
        (o[0] === val ? "on" : "") +
        '" aria-pressed="' +
        (o[0] === val) +
        '">' +
        esc(o[1]) +
        "</button>"
    ).join("") +
    "</div></div>"
  );
}

export function bindCatPicker(form, onChange) {
  const box = form.querySelector("[data-catbox]");
  if (!box) return { reset() {}, get: () => "task" };
  const inp = box.querySelector('input[name="cat"]');
  const paint = (val) => {
    inp.value = val;
    box.querySelectorAll("[data-tcat]").forEach((b) => {
      const on = b.dataset.tcat === val;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on);
    });
    if (onChange) onChange(val);
  };
  box.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tcat]");
    if (b && box.contains(b)) paint(b.dataset.tcat);
  });
  return { reset: () => paint("task"), set: paint, get: () => inp.value };
}

/* Wszystkie zadania przypadające w czasie trwania konkretnych zajęć */
export const tasksOf = (item) => tasksForClass(cache.plan, item);

export const tkKey = (t) => (t.due ? t.due + (t.time || "23:59") : "9");

export function taskMeta(t) {
  if (!t.due) return "Bez terminu";
  const d = fromDK(t.due);
  return (
    "Termin: " +
    d.toLocaleDateString("pl-PL", { weekday: "short", day: "numeric", month: "short" }) +
    (t.time ? ", " + fmtT(t.time) : "") +
    (isLate(t) ? " · po terminie" : "") +
    (t.url ? " · link" : "")
  );
}

function tkRow(t) {
  const label = taskLabelOf(t);
  const exam = isExamTask(t);
  const txEmpty = !(typeof t.text === "string" && t.text.trim());
  const metaParts = [];
  if (label && !txEmpty) metaParts.push(label);
  if (label && macOf(label)) metaParts.push("Mac: " + MAC_TXT[macOf(label)]);
  metaParts.push(taskMeta(t));
  const ariaName = taskTitle(t) + (label ? " (" + label + ")" : "");
  return (
    '<div class="tk-row' +
    (t.done ? " done" : "") +
    (isLate(t) ? " late" : "") +
    (exam ? " exam" : "") +
    '"><button type="button" class="tk-cb" role="checkbox" aria-checked="' +
    (t.done ? "true" : "false") +
    '" aria-label="Ukończone: ' +
    esc(ariaName) +
    '" data-a="tg:' +
    esc(t.id) +
    '"><i>' +
    (t.done ? "✓" : "") +
    '</i></button><button type="button" class="tk-body tkopen" data-a="to:' +
    esc(t.id) +
    '"><span class="tk-tx">' +
    taskHeadingHtml(t) +
    "</span>" +
    taskNoteHtml(t) +
    '<span class="tk-meta">' +
    esc(metaParts.join(" · ")) +
    "</span></button></div>"
  );
}

function taskFilterSubjects() {
  const map = new Map();
  for (const t of cache.plan.tasks) {
    const lbl = taskLabelOf(t);
    if (lbl) map.set(nameLc(lbl), lbl);
  }
  for (const c of cache.plan.classes) {
    if (c.name) map.set(nameLc(c.name), c.name);
  }
  const arr = [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], "pl"));
  return [["", "Wszystkie przedmioty"]].concat(arr);
}

let filtSubjSig = "";
let filtCatInit = false;

export function initTaskFilters() {
  const qEl = $("tkSearch");
  const sEl = $("tkSubj");
  const cEl = $("tkCat");
  if (!qEl || !sEl || !cEl) return;
  qEl.addEventListener("input", () => {
    ui.tkQuery = qEl.value;
    renderTasks();
  });
  sEl.addEventListener("change", () => {
    ui.tkSubj = sEl.value;
    renderTasks();
  });
  cEl.addEventListener("change", () => {
    ui.tkCat = cEl.value;
    renderTasks();
  });
}

function syncFilterControls() {
  const qEl = $("tkSearch");
  const sEl = $("tkSubj");
  const cEl = $("tkCat");
  if (!qEl || !sEl || !cEl) return;
  if (qEl.value !== ui.tkQuery) qEl.value = ui.tkQuery;
  const pairs = taskFilterSubjects();
  const sig = JSON.stringify(pairs);
  if (sig !== filtSubjSig) {
    filtSubjSig = sig;
    if (ui.tkSubj && !pairs.some((p) => p[0] === ui.tkSubj)) ui.tkSubj = "";
    sEl.innerHTML = selOpts(pairs, ui.tkSubj);
  } else if (sEl.value !== ui.tkSubj) {
    sEl.value = ui.tkSubj;
  }
  if (!filtCatInit) {
    filtCatInit = true;
    cEl.innerHTML = selOpts([["", "Wszystkie typy"]].concat(TASK_TYPE_PAIRS), ui.tkCat);
  } else if (cEl.value !== ui.tkCat) {
    cEl.value = ui.tkCat;
  }
}

export function renderTasks() {
  $("hdBtn").setAttribute("aria-checked", ui.hideDone ? "true" : "false");
  const exBtn = $("exBtn");
  if (exBtn) {
    const exN = cache.plan.tasks.filter((t) => !t.done && isExamTask(t)).length;
    exBtn.textContent = exN ? "Sesja / Kolokwia (" + exN + ")" : "Sesja / Kolokwia";
  }

  const showAdd = !!ui.olOpen;
  if (!ui.olAnim) {
    $("olBtn").setAttribute("aria-expanded", showAdd ? "true" : "false");
    $("tkOlWrap").hidden = !showAdd;
  }
  if (showAdd) refreshOlForm();

  syncFilterControls();

  const all = cache.plan.tasks;
  const q = nameLc(ui.tkQuery.trim());
  const filtered = all.filter((t) => {
    if (ui.hideDone && t.done) return false;
    if (ui.tkSubj && nameLc(taskLabelOf(t)) !== ui.tkSubj) return false;
    if (ui.tkCat) {
      if (ui.tkCat === "exam") {
        if (!isExamTask(t)) return false;
      } else if (taskCat(t) !== ui.tkCat) {
        return false;
      }
    }
    if (q) {
      const catName = TASK_TYPES[taskCat(t)] || "";
      const hay = nameLc(t.text) + " " + nameLc(t.note) + " " + nameLc(taskLabelOf(t)) + " " + nameLc(catName);
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const box = $("tkLists");
  const af = document.activeElement && box.contains(document.activeElement) ? document.activeElement.dataset.a : null;
  const hasActiveFilters = !!(q || ui.tkSubj || ui.tkCat);

  if (!filtered.length) {
    box.innerHTML =
      '<div class="free">' +
      (hasActiveFilters
        ? "Brak zadań pasujących do wybranych filtrów."
        : all.length
        ? "Wszystkie zadania są ukończone (ukryte)."
        : "Brak zadań. Stuknij „+ Dodaj zadanie” albo wybierz zajęcia na planie.") +
      "</div>";
    return;
  }

  box.innerHTML = GROUPS.map((g) => {
    const arr = filtered
      .filter((t) => taskGroup(t, ui.now) === g[0])
      .sort((a, b) => (g[0] === "done" ? tkKey(b).localeCompare(tkKey(a)) : tkKey(a).localeCompare(tkKey(b))));
    return arr.length
      ? '<h2 class="hh grp' +
          (g[0] === "over" ? " over" : "") +
          '"><span>' +
          g[1] +
          "</span><em>" +
          arr.length +
          '</em></h2><div class="tk-list">' +
          arr.map(tkRow).join("") +
          "</div>"
      : "";
  }).join("");

  if (af) {
    const e = box.querySelector('[data-a="' + af + '"]');
    if (e) e.focus({ preventScroll: true });
  }
}

/* ----- Termin powiadomienia w formularzu zadania ----- */
const REL_OPTS = [5, 10, 15, 30, 60, 120, 300];

export function fmtDur(m) {
  if (m >= 1440 && m % 1440 === 0) {
    const n = m / 1440;
    return n === 1 ? "24 godz." : n + " dni";
  }
  if (m >= 60 && m % 60 === 0) return m / 60 + " godz.";
  if (m >= 60) return Math.floor(m / 60) + " godz. " + (m % 60) + " min";
  return m + " min";
}

export function ruleLabel(r) {
  if (r.m === "rel") return fmtDur(r.min) + " przed terminem";
  return (
    (r.days === 0 ? "w dniu terminu" : r.days === 1 ? "dzień przed terminem" : r.days + " dni przed terminem") +
    ", o " +
    fmtT(r.time)
  );
}

export function whenWordAt(d) {
  const diff = Math.round((day0(d) - day0(new Date())) / 864e5);
  return (
    (diff === 0 ? "dziś" : diff === 1 ? "jutro" : diff === 2 ? "pojutrze" : diff === -1 ? "wczoraj" : dlong(d)) +
    " o " +
    fmtT(hm(d))
  );
}

export function remHtml(rem) {
  const mode = !rem ? "def" : rem.m === "abs" ? "abs" : "rel";
  const mins = REL_OPTS.slice();
  if (rem && rem.m === "rel" && !mins.includes(rem.min)) {
    mins.push(rem.min);
    mins.sort((a, b) => a - b);
  }
  return (
    '<div class="remb" data-rem><span class="lbl">Powiadomienie</span>' +
    '<div class="seg remseg" role="group" aria-label="Jak ustawić termin powiadomienia">' +
    [
      ["def", "Domyślne"],
      ["rel", "Przed terminem"],
      ["abs", "Data i godzina"],
    ]
      .map(
        (o) =>
          '<button type="button" data-rm="' +
          o[0] +
          '" class="' +
          (o[0] === mode ? "on" : "") +
          '" aria-pressed="' +
          (o[0] === mode) +
          '">' +
          o[1] +
          "</button>"
      )
      .join("") +
    "</div>" +
    '<div class="rchips" data-rp="rel" role="group" aria-label="Ile czasu przed terminem"' +
    (mode === "rel" ? "" : " hidden") +
    ">" +
    mins
      .map((m) => {
        const on = !!rem && rem.m === "rel" && rem.min === m;
        return (
          '<button type="button" data-rmin="' +
          m +
          '" class="' +
          (on ? "on" : "") +
          '" aria-pressed="' +
          on +
          '">' +
          fmtDur(m) +
          "</button>"
        );
      })
      .join("") +
    "</div>" +
    '<label class="fl" data-rp="abs"' +
    (mode === "abs" ? "" : " hidden") +
    '>Data i godzina powiadomienia<input type="datetime-local" name="remAt" value="' +
    esc(rem && rem.m === "abs" ? rem.at : "") +
    '"></label><p class="hint" data-rinfo></p><p class="rprev" data-rprev role="status" aria-live="polite"></p></div>'
  );
}

export function remBind(form, getEnd, isNew) {
  const box = form.querySelector("[data-rem]");
  const at = box.querySelector('[name="remAt"]');
  const info = box.querySelector("[data-rinfo]");
  const prev = box.querySelector("[data-rprev]");
  let mode = box.querySelector("[data-rm].on").dataset.rm;
  let min = 0;
  const cur = box.querySelector("[data-rmin].on");
  if (cur) min = +cur.dataset.rmin;

  function calc() {
    const end = getEnd();
    let rule = null;
    let eff;
    let err = "";
    if (mode === "def") eff = ruleOf({}, cache.plan.notif);
    else if (mode === "rel") {
      if (min) rule = eff = { m: "rel", min };
      else err = "Wybierz, ile czasu przed terminem ma przyjść powiadomienie.";
    } else {
      const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(at.value);
      if (m && fromDK(m[1])) rule = eff = { m: "abs", at: m[1] + "T" + m[2] };
      else err = "Wybierz datę i godzinę powiadomienia.";
    }
    let start = null;
    if (eff && end) {
      start = ruleStart(eff, day0(end), end);
      if (start > end) {
        if (mode === "abs") err = "Powiadomienie musi przyjść przed terminem zadania (" + whenWordAt(end) + ").";
        else start = end;
      }
    }
    return { end, rule, eff, err, start };
  }

  function update() {
    const c = calc();
    info.textContent = mode === "def" ? "Wg ustawień domyślnych: " + ruleLabel(c.eff) + "." : "";
    let txt = "";
    let cls = "rprev";
    if (c.err) {
      txt = c.err;
      cls += " bad";
    } else if (!c.end) {
      txt = "Wybierz termin zadania, aby zobaczyć, kiedy przyjdzie powiadomienie.";
    } else if (c.start < new Date()) {
      txt =
        "Ten moment (" +
        whenWordAt(c.start) +
        ") już minął" +
        (isNew ? ", więc powiadomienie dla tego zadania nie zostanie wysłane." : ".");
      cls += " warn";
    } else {
      txt = "Powiadomienie przyjdzie: " + whenWordAt(c.start);
    }
    prev.textContent = txt;
    prev.className = cls;
  }

  function paint() {
    box.querySelectorAll("[data-rm]").forEach((b) => {
      const on = b.dataset.rm === mode;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on);
    });
    box.querySelectorAll("[data-rmin]").forEach((b) => {
      const on = +b.dataset.rmin === min;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on);
    });
    box.querySelectorAll("[data-rp]").forEach((e) => {
      e.hidden = e.dataset.rp !== mode;
    });
    update();
  }

  box.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || !box.contains(b)) return;
    if (b.dataset.rm) {
      mode = b.dataset.rm;
      if (mode === "rel" && !min) min = 60;
      if (mode === "abs" && !at.value) {
        const end = getEnd();
        if (end) {
          let s = ruleStart(ruleOf({}, cache.plan.notif), day0(end), end);
          if (s > end || s <= new Date()) s = new Date(end.getTime() - 36e5);
          at.value = fmtLocal(s);
        }
      }
      paint();
    } else if (b.dataset.rmin) {
      min = +b.dataset.rmin;
      paint();
    }
  });
  form.addEventListener("input", update);
  form.addEventListener("change", update);
  update();

  return {
    update,
    reset() {
      mode = "def";
      min = 0;
      at.value = "";
      paint();
    },
    read() {
      const c = calc();
      return c.err ? { ok: false, err: c.err, el: mode === "abs" ? at : null } : { ok: true, rem: c.rule || undefined };
    },
  };
}

export function setRem(x, rem) {
  const a = JSON.stringify(x.rem || null);
  const b = JSON.stringify(rem || null);
  if (rem) x.rem = rem;
  else delete x.rem;
  if (a !== b) x.at = Date.now();
}

/* ----- Wspólny formularz zadania (zakładka Zadania, szczegóły zajęć, edycja) ----- */
export function subjPairs() {
  const s = cache.plan.subjects;
  const have = new Set(s.map((x) => x.name.toLowerCase()));
  const out = s.map((x) => [x.id, x.name]);
  for (const n of new Set(cache.plan.classes.map((c) => c.name))) {
    if (!have.has(n.toLowerCase())) {
      have.add(n.toLowerCase());
      out.push(["n:" + n, n]);
    }
  }
  out.sort((a, b) => a[1].localeCompare(b[1], "pl"));
  return [["", "— bez przedmiotu —"]].concat(out);
}

export function subjValueForName(name) {
  if (!name) return "";
  const lc = name.trim().toLowerCase();
  const s = cache.plan.subjects.find((x) => x.name.trim().toLowerCase() === lc);
  if (s) return s.id;
  const c = cache.plan.classes.find((x) => x.name.trim().toLowerCase() === lc);
  return c ? "n:" + c.name : "";
}

export function subjNameFromVal(val) {
  if (!val) return "";
  if (val.startsWith("n:")) return val.slice(2);
  const s = cache.plan.subjects.find((x) => x.id === val);
  return s ? s.name : "";
}

export function applySubject(p, val) {
  if (!val) return "";
  if (val.startsWith("n:")) {
    const n = val.slice(2);
    let s = p.subjects.find((x) => x.name.toLowerCase() === n.toLowerCase());
    if (!s) {
      s = { id: uid(), name: n, desc: "", req: "", forms: {}, mac: "" };
      p.subjects.push(s);
    }
    return s.id;
  }
  return val;
}

export function taskFieldsHtml(v) {
  const cat = v.cat || "task";
  const hideTitle = cat === "exam";
  return (
    catPickerHtml(cat) +
    '<label class="fl" data-txwrap' +
    (hideTitle ? " hidden" : "") +
    '><span data-txlbl>' +
    (cat === "report" ? "Nazwa sprawozdania (opcjonalnie)" : cat === "project" ? "Nazwa projektu" : "Treść zadania") +
    '</span><input name="text" maxlength="300" value="' +
    esc(v.text || "") +
    '" placeholder="' +
    esc(
      cat === "report"
        ? "np. Lab 4 — algorytmy (można pominąć)"
        : cat === "project"
        ? "np. Aplikacja webowa — etap 1"
        : "np. Zadania 1–5 str. 40"
    ) +
    '"></label>' +
    '<label class="fl" data-notewrap><span data-notelbl>' +
    (cat === "exam" ? "Zakres materiału / opis" : "Opis / notatka (opcjonalnie)") +
    '</span><textarea name="note" rows="3" maxlength="1000" placeholder="' +
    esc(
      cat === "exam"
        ? "np. Rozdziały 1–3, całki nieoznaczone, definicje z wykładu…"
        : "Dodatkowe informacje, wymagania, zagadnienia…"
    ) +
    '">' +
    esc(v.note || "") +
    "</textarea></label>" +
    '<label class="fl">Przedmiot<select name="subj">' +
    selOpts(subjPairs(), v.subj || "") +
    "</select></label>" +
    '<div class="qdates' +
    (v.isEdit ? " qdates-edit" : "") +
    '" data-qdate role="group" aria-label="Szybki wybór terminu"' +
    (v.isEdit ? " hidden" : "") +
    ">" +
    (v.isEdit
      ? '<button type="button" data-qd="next" hidden>Przełóż na następne zajęcia</button>'
      : '<button type="button" data-qd="today">Dziś</button>' +
        '<button type="button" data-qd="tomorrow">Jutro</button>' +
        '<button type="button" data-qd="week">Za tydzień</button>' +
        '<button type="button" data-qd="next" hidden>Następne zajęcia</button>') +
    "</div>" +
    '<div class="two"><label class="fl">Termin<input type="date" name="due" value="' +
    esc(v.due || "") +
    '"></label><label class="fl">Godzina (opcjonalnie)<div class="tmwrap"><input type="time" name="time" value="' +
    esc(v.time || "") +
    '"><button type="button" class="tmclr" data-cleartime aria-label="Wyczyść godzinę (całodniowe)" title="Całodniowe (bez godziny)"' +
    (v.time ? "" : " hidden") +
    ">×</button></div></label></div>" +
    '<label class="fl">Link (opcjonalnie)<input type="url" name="url" maxlength="300" value="' +
    esc(v.url || "") +
    '" placeholder="https://… (np. Teams, Moodle)"></label>' +
    remHtml(v.rem) +
    '<p class="msg bad" data-err role="alert"></p>'
  );
}

const taskEnd = (f) => () => endOf(f.elements.due.value, f.elements.time.value.trim() || "23:59");

export function bindTaskForm(form, isNew) {
  const E = form.elements;
  const txWrap = form.querySelector("[data-txwrap]");
  const txLbl = form.querySelector("[data-txlbl]");
  const noteLbl = form.querySelector("[data-notelbl]");
  const qBox = form.querySelector("[data-qdate]");
  const nextBtn = qBox ? qBox.querySelector('[data-qd="next"]') : null;
  const clrTime = form.querySelector("[data-cleartime]");

  const syncCatUi = (cat) => {
    if (txWrap) txWrap.hidden = cat === "exam";
    if (txLbl) {
      txLbl.textContent =
        cat === "report"
          ? "Nazwa sprawozdania (opcjonalnie)"
          : cat === "project"
          ? "Nazwa projektu"
          : "Treść zadania";
    }
    if (E.text) {
      E.text.placeholder =
        cat === "report"
          ? "np. Lab 4 — algorytmy (można pominąć)"
          : cat === "project"
          ? "np. Aplikacja webowa — etap 1"
          : "np. Zadania 1–5 str. 40";
    }
    if (noteLbl) {
      noteLbl.textContent = cat === "exam" ? "Zakres materiału / opis" : "Opis / notatka (opcjonalnie)";
    }
    if (E.note) {
      E.note.placeholder =
        cat === "exam"
          ? "np. Rozdziały 1–3, całki nieoznaczone, definicje z wykładu…"
          : "Dodatkowe informacje, wymagania, zagadnienia…";
    }
  };

  let nextOcc = null;
  const syncNextChip = () => {
    if (!nextBtn || !E.subj) return;
    const sname = subjNameFromVal(E.subj.value);
    let from = new Date();
    let opts = {};
    if (!isNew && E.due && E.due.value) {
      const curDue = fromDK(E.due.value);
      const td = day0(new Date());
      if (curDue && curDue >= td) {
        from = new Date(curDue.getFullYear(), curDue.getMonth(), curDue.getDate() + 1, 0, 0);
      }
      if (E.time && E.time.value.trim()) {
        const sid = E.subj.value && !E.subj.value.startsWith("n:") ? E.subj.value : "";
        const curCls = classForTask(cache.plan, { due: E.due.value, time: E.time.value.trim(), sid });
        if (curCls && curCls.c && nameLc(curCls.c.name) === nameLc(sname)) {
          opts = { cid: curCls.id, type: curCls.c.type };
        }
      }
    }
    nextOcc = sname ? nextOccurrenceBySubject(cache.plan, sname, from, opts) : null;
    if (nextOcc) {
      const wdTxt = nextOcc.date.toLocaleDateString("pl-PL", { weekday: "short", day: "numeric", month: "short" });
      nextBtn.textContent =
        (isNew ? "Następne zajęcia (" : "Przełóż na następne zajęcia (") + wdTxt + ", " + fmtT(nextOcc.s) + ")";
      nextBtn.hidden = false;
      if (!isNew && qBox) qBox.hidden = false;
    } else {
      nextBtn.hidden = true;
      if (!isNew && qBox) qBox.hidden = true;
    }
  };

  const syncTimeClear = () => {
    if (clrTime && E.time) clrTime.hidden = !E.time.value.trim();
  };

  const catCtrl = bindCatPicker(form, syncCatUi);
  const remCtrl = remBind(form, taskEnd(form), isNew);

  if (E.subj) E.subj.addEventListener("change", syncNextChip);
  if (E.due && !isNew) E.due.addEventListener("change", syncNextChip);
  if (E.time) {
    E.time.addEventListener("input", syncTimeClear);
    E.time.addEventListener("change", syncTimeClear);
  }
  if (clrTime) {
    clrTime.addEventListener("click", () => {
      E.time.value = "";
      syncTimeClear();
      remCtrl.update();
    });
  }
  if (qBox) {
    qBox.addEventListener("click", (e) => {
      const b = e.target.closest("[data-qd]");
      if (!b) return;
      const now = day0(new Date());
      const k = b.dataset.qd;
      if (k === "today") E.due.value = dk(now);
      else if (k === "tomorrow") E.due.value = dk(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
      else if (k === "week") E.due.value = dk(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));
      else if (k === "next" && nextOcc) {
        E.due.value = nextOcc.dk;
        E.time.value = nextOcc.s;
        syncTimeClear();
        if (!isNew) syncNextChip();
      }
      remCtrl.update();
    });
  }

  syncCatUi(catCtrl.get());
  syncNextChip();
  syncTimeClear();

  return {
    cat: catCtrl,
    rem: remCtrl,
    syncNextChip,
    syncTimeClear,
    read(errEl) {
      return readTaskForm(form, errEl, remCtrl);
    },
    reset(defaults) {
      if (defaults) {
        if (defaults.text !== undefined) E.text.value = defaults.text;
        if (defaults.note !== undefined) E.note.value = defaults.note;
        if (defaults.url !== undefined) E.url.value = defaults.url;
        if (defaults.due !== undefined) E.due.value = defaults.due;
        if (defaults.time !== undefined) E.time.value = defaults.time;
        if (defaults.subj !== undefined) E.subj.value = defaults.subj;
      }
      catCtrl.reset();
      remCtrl.reset();
      syncNextChip();
      syncTimeClear();
    },
  };
}

export function readTaskForm(f, errEl, rb) {
  const E = f.elements;
  const cat = E.cat ? E.cat.value : "task";
  const text = cat === "exam" ? "" : E.text.value.trim();
  const note = E.note ? E.note.value.trim() : "";
  const due = E.due.value;
  const tv = E.time.value.trim();
  const rawUrl = E.url ? E.url.value.trim() : "";
  const err = (m, el) => {
    errEl.textContent = m;
    if (el) el.focus();
    return null;
  };
  if (!text && cat !== "exam" && cat !== "report") {
    return err(cat === "project" ? "Wpisz nazwę projektu." : "Wpisz treść zadania.", E.text);
  }
  if (!fromDK(due)) return err("Wybierz termin (datę).", E.due);
  if (tv && !normT(tv)) return err("Podaj poprawną godzinę.", E.time);
  let url = "";
  if (rawUrl) {
    const cand = /^https?:\/\//i.test(rawUrl) ? rawUrl : "https://" + rawUrl;
    if (!/^https?:\/\/\S+\.\S+$/i.test(cand)) return err("Podaj poprawny adres linku (np. https://…).", E.url);
    url = cand;
  }
  const r = rb.read();
  if (!r.ok) return err(r.err, r.el);
  errEl.textContent = "";
  return {
    text,
    note,
    url,
    due,
    time: tv ? normT(tv) : "",
    subj: E.subj.value,
    rem: r.rem,
    cat,
  };
}

const tomorrowDK = () => {
  const x = new Date();
  return dk(new Date(x.getFullYear(), x.getMonth(), x.getDate() + 1));
};

let olSig = "";
let olFormCtrl = null;

export function initOlForm() {
  const box = $("tkOnlineForm");
  box.innerHTML =
    '<form id="olf" novalidate autocomplete="off">' +
    taskFieldsHtml({ text: "", note: "", url: "", subj: "", due: tomorrowDK(), time: "", cat: "task" }) +
    '<div class="acts"><button type="submit" class="btn pri">Dodaj zadanie</button></div></form>';
  olSig = JSON.stringify(subjPairs());
  olFormCtrl = bindTaskForm($("olf"), true);
  $("olf").onsubmit = (ev) => {
    ev.preventDefault();
    const f = $("olf");
    const v = olFormCtrl.read(f.querySelector("[data-err]"));
    if (!v) return;
    let newId = "";
    const ok = change((p) => {
      const t = {
        id: uid(),
        sid: applySubject(p, v.subj),
        cid: "",
        at: Date.now(),
        date: "",
        text: v.text,
        due: v.due,
        time: v.time,
        url: v.url,
        note: v.note,
        done: false,
      };
      if (v.cat && v.cat !== "task") t.cat = v.cat;
      if (v.rem) t.rem = v.rem;
      newId = t.id;
      p.tasks.push(t);
    }, v.cat === "exam" ? "Dodano kolokwium" : v.cat === "report" ? "Dodano sprawozdanie" : "Dodano zadanie");
    if (ok) {
      olFormCtrl.reset({ text: "", note: "", url: "", due: tomorrowDK(), time: "" });
      toggleOl(false);
      flashTask(newId);
    }
  };
}

export function toggleOl(open) {
  ui.olOpen = open;
  const w = $("tkOlWrap");
  const c = $("tkOnlineForm");
  $("olBtn").setAttribute("aria-expanded", open ? "true" : "false");
  if (ui.olAnim) {
    ui.olAnim.cancel();
    ui.olAnim = null;
  }
  const focusFirst = () => {
    const f = $("olf");
    if (!f) return;
    const cat = f.elements.cat ? f.elements.cat.value : "task";
    const el = cat === "exam" ? f.elements.note : f.elements.text;
    if (el) el.focus({ preventScroll: true });
  };
  if (reduced() || !w.animate) {
    w.hidden = !open;
    if (open) {
      refreshOlForm();
      focusFirst();
    }
    return;
  }
  if (open) {
    w.hidden = false;
    refreshOlForm();
  }
  const h = w.scrollHeight;
  const a = (ui.olAnim = w.animate(open ? [{ height: "0px" }, { height: h + "px" }] : [{ height: h + "px" }, { height: "0px" }], {
    duration: open ? 340 : 280,
    easing: "cubic-bezier(.2,.8,.2,1)",
  }));
  c.animate(
    open
      ? [{ opacity: 0, transform: "translateY(-8px)" }, { opacity: 1, transform: "none" }]
      : [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-8px)" }],
    { duration: open ? 300 : 200, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" }
  );
  const fin = () => {
    if (ui.olAnim !== a) return;
    ui.olAnim = null;
    w.hidden = !ui.olOpen;
    if (ui.olOpen) focusFirst();
  };
  a.onfinish = fin;
  a.oncancel = () => {
    if (ui.olAnim === a) ui.olAnim = null;
  };
}

function flashTask(id) {
  const row = document.querySelector('#tkLists [data-a="to:' + id + '"]');
  const r = row && row.closest(".tk-row");
  if (!r) return;
  r.classList.add("new");
  setTimeout(() => r.classList.remove("new"), 1400);
  if (r.animate && !reduced()) {
    r.animate([{ opacity: 0, transform: "translateY(-10px)" }, { opacity: 1, transform: "none" }], {
      duration: 380,
      delay: 120,
      easing: "cubic-bezier(.2,.8,.2,1)",
      fill: "backwards",
    });
  }
}

export function refreshOlForm() {
  if (olFormCtrl) {
    olFormCtrl.rem.update();
    olFormCtrl.syncNextChip();
  }
  const sig = JSON.stringify(subjPairs());
  if (sig === olSig) return;
  olSig = sig;
  const s = $("olf").elements.subj;
  const cur = s.value;
  s.innerHTML = selOpts(subjPairs(), cur);
  if (olFormCtrl) olFormCtrl.syncNextChip();
}

/* ----- Jedno, pełne okno edycji każdego zadania ----- */
export function openTask(id, opts = {}) {
  const t = cache.plan.tasks.find((x) => x.id === id);
  if (!t) return;
  const sname = taskLabelOf(t);
  let sv = "";
  if (t.sid && cache.plan.subjects.some((s) => s.id === t.sid)) sv = t.sid;
  else if (sname) sv = subjValueForName(sname);

  const matchedCls = classForTask(cache.plan, t);
  const back = opts.back || null;
  ui.ctx = { tid: id, view: "tkedit", back };

  const cat = taskCat(t);
  const sheetTitle = cat === "exam" ? "Kolokwium" : cat === "report" ? "Sprawozdanie" : cat === "project" ? "Projekt" : "Zadanie";

  const clsBanner = matchedCls
    ? '<button type="button" class="dt-subj tk-cls-jump" data-sh="tgo:' +
      esc(matchedCls.id) +
      "|" +
      esc(matchedCls.date) +
      '"><span>W czasie zajęć: <b>' +
      esc(matchedCls.c.name) +
      "</b> (" +
      esc(fmtT(matchedCls.c.s)) +
      "–" +
      esc(fmtT(matchedCls.c.e)) +
      ')</span><b aria-hidden="true">›</b></button>'
    : "";

  const urlBanner = t.url
    ? '<a class="tk-url-btn" href="' + esc(t.url) + '" target="_blank" rel="noopener noreferrer">Otwórz link ↗</a>'
    : "";

  openSheet(
    sheetTitle,
    clsBanner +
      urlBanner +
      '<form id="ole" novalidate autocomplete="off">' +
      taskFieldsHtml({
        text: t.text,
        note: t.note,
        url: t.url,
        subj: sv,
        due: t.due,
        time: t.time || "",
        rem: t.rem,
        cat,
        isEdit: true,
      }) +
      '<div class="acts"><button type="submit" class="btn pri">Zapisz</button><button type="button" class="btn" data-sh="' +
      (back ? "tkback" : "close") +
      '">' +
      (back ? "Wróć" : "Anuluj") +
      '</button><button type="button" class="btn dng" data-sh="oldel">Usuń</button></div></form>'
  );

  const f = $("ole");
  const ctrl = bindTaskForm(f, false);
  f.onsubmit = (ev) => {
    ev.preventDefault();
    const v = ctrl.read(f.querySelector("[data-err]"));
    if (!v) return;
    const ok = change((p) => {
      const x = p.tasks.find((y) => y.id === id);
      if (x) {
        x.text = v.text;
        x.note = v.note;
        x.url = v.url;
        x.due = v.due;
        x.time = v.time;
        x.sid = applySubject(p, v.subj);
        /* Zadanie żyje niezależnie — czyścimy przestarzałe sztywne powiązania ze starych wersji */
        x.cid = "";
        x.date = "";
        delete x.kind;
        if (v.cat && v.cat !== "task") x.cat = v.cat;
        else delete x.cat;
        setRem(x, v.rem);
      }
    });
    if (ok) tkBack();
  };
}

export function tkBack() {
  const b = ui.ctx && ui.ctx.back;
  if (b && b.view === "detail" && cache.plan.classes.some((c) => c.id === b.cid)) {
    app.openDetail(b.cid, b.date);
  } else if (b && b.view === "subj" && b.sname) {
    app.openSubject(b.sname, "tasks");
  } else if (b && b.view === "exams") {
    openExams();
  } else {
    closeSheet();
  }
}

export function toggleTask(id) {
  change((p) => {
    const t = p.tasks.find((x) => x.id === id);
    if (t) t.done = !t.done;
  });
  popCb(id);
}

export function openAlertTask(id) {
  openTask(id);
}

/* Widok „Sesja / Kolokwia”: wszystkie nadchodzące kolokwia z odliczaniem dni, salą i pełnym zakresem materiału */
export function openExams() {
  ui.ctx = { view: "exams" };
  const td = day0(new Date());
  const list = cache.plan.tasks
    .filter((t) => !t.done && isExamTask(t))
    .sort((a, b) => tkKey(a).localeCompare(tkKey(b)));

  const cards = list
    .map((t) => {
      const sub = taskLabelOf(t);
      const tx = (t.text || "").trim();
      const head = tx && sub ? tx + " · " + sub : tx || sub || "Kolokwium";
      const d = t.due ? fromDK(t.due) : null;
      const diff = d ? Math.round((d - td) / 864e5) : null;
      let cntTxt = "Bez terminu";
      let cntCls = "";
      if (diff !== null) {
        if (diff < 0) {
          cntTxt = "Po terminie (" + Math.abs(diff) + " d)";
          cntCls = " late";
        } else if (diff === 0) {
          cntTxt = "Dziś";
          cntCls = " soon";
        } else if (diff === 1) {
          cntTxt = "Jutro";
          cntCls = " soon";
        } else if (diff === 2) {
          cntTxt = "Pojutrze";
          cntCls = " soon";
        } else {
          cntTxt = "Za " + diff + " dni";
        }
      }
      const cls = classForTask(cache.plan, t);
      const dateStr = d
        ? d.toLocaleDateString("pl-PL", { weekday: "short", day: "numeric", month: "long" }) +
          (t.time ? ", " + fmtT(t.time) : "")
        : "Brak daty";
      const roomStr = cls && cls.c && cls.c.room ? " · " + cls.c.room : "";
      const scope = (t.note || "").trim();
      return (
        '<div class="ex-card">' +
        '<div class="ex-head"><span class="ex-cnt' +
        cntCls +
        '">' +
        esc(cntTxt) +
        '</span><span class="ex-dt">' +
        esc(dateStr + roomStr) +
        "</span></div>" +
        '<div class="ex-title">' +
        esc(head) +
        "</div>" +
        (scope
          ? '<div class="ex-scope">' + esc(scope) + "</div>"
          : '<div class="ex-scope empty">Brak opisu zakresu materiału.</div>') +
        '<div class="ex-acts">' +
        '<button type="button" class="btn" data-sh="exedit:' +
        esc(t.id) +
        '">Edytuj</button>' +
        '<button type="button" class="btn" data-sh="exdone:' +
        esc(t.id) +
        '">Zaliczone ✓</button>' +
        "</div></div>"
      );
    })
    .join("");

  openSheet(
    "Sesja / Kolokwia",
    '<p class="shsub">' +
      (list.length
        ? "Nadchodzące kolokwia i egzaminy: " + list.length
        : "Brak zaplanowanych kolokwiów i egzaminów.") +
      "</p>" +
      (list.length ? '<div class="ex-list">' + cards + "</div>" : '<div class="free">Czysto! Dodaj kolokwium przyciskiem poniżej.</div>') +
      '<div class="acts"><button type="button" class="btn pri" data-sh="exadd">+ Dodaj kolokwium</button><button type="button" class="btn" data-sh="close">Zamknij</button></div>'
  );
}

/* Szybkie okno dodawania zadania (np. z zakładki Przedmioty lub widoku Sesja/Kolokwia) */
export function openNewTask(opts = {}) {
  const back = opts.back || null;
  const cat = opts.cat || "task";
  ui.ctx = { view: "tknew", back };
  const title = cat === "exam" ? "Nowe kolokwium" : cat === "report" ? "Nowe sprawozdanie" : "Nowe zadanie";
  openSheet(
    title,
    '<form id="tkNewF" novalidate autocomplete="off">' +
      taskFieldsHtml({
        text: "",
        note: "",
        url: "",
        subj: opts.subj || "",
        due: opts.due || tomorrowDK(),
        time: opts.time || "",
        cat,
      }) +
      '<div class="acts"><button type="submit" class="btn pri">Dodaj</button><button type="button" class="btn" data-sh="' +
      (back ? "tkback" : "close") +
      '">' +
      (back ? "Wróć" : "Anuluj") +
      "</button></div></form>"
  );
  const f = $("tkNewF");
  const ctrl = bindTaskForm(f, true);
  f.onsubmit = (ev) => {
    ev.preventDefault();
    const v = ctrl.read(f.querySelector("[data-err]"));
    if (!v) return;
    const ok = change((p) => {
      const t = {
        id: uid(),
        sid: applySubject(p, v.subj),
        cid: "",
        at: Date.now(),
        date: "",
        text: v.text,
        due: v.due,
        time: v.time,
        url: v.url,
        note: v.note,
        done: false,
      };
      if (v.cat && v.cat !== "task") t.cat = v.cat;
      if (v.rem) t.rem = v.rem;
      p.tasks.push(t);
    }, v.cat === "exam" ? "Dodano kolokwium" : v.cat === "report" ? "Dodano sprawozdanie" : "Dodano zadanie");
    if (ok) tkBack();
  };
}

