/* ===== Centrum zadań (wszystkie, stacjonarne i online), filtry, typy oraz termin powiadomienia ===== */

import { GROUPS, MAC_TXT, TASK_TYPES, TASK_TYPE_PAIRS } from "../config.js";
import { day0, dk, fromDK, normT, fmtT, uid, endOf, ruleOf, ruleStart, isLate, taskGroup, taskCat, isExamTask } from "../core.js";
import { cache } from "../sync.js";
import { $, esc, reduced, dlong, hm, fmtLocal, nameLc, selOpts, ui, app } from "../state.js";
import { openSheet, closeSheet, change, popCb } from "./sheet.js";
import { macOf } from "./subjects.js";

const subjName = (sid) => {
  const s = cache.plan.subjects.find((x) => x.id === sid);
  return s ? s.name : "";
};

export function taskLabelOf(t) {
  return t.kind === "online"
    ? subjName(t.sid) || "Online"
    : (cache.plan.classes.find((c) => c.id === t.cid) || {}).name || "Zajęcia";
}

/* Odznaka typu zadania (Kolokwium / Sprawozdanie / Projekt); domyślne „Zadanie” nie zaśmieca wiersza */
export function catChip(t) {
  const c = taskCat(t);
  const eff = c === "task" && isExamTask(t) ? "exam" : c;
  if (eff === "task") return "";
  return '<span class="tcat ' + eff + '">' + esc(TASK_TYPES[eff]) + "</span>";
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

export function bindCatPicker(form) {
  const box = form.querySelector("[data-catbox]");
  if (!box) return { reset() {} };
  const inp = box.querySelector('input[name="cat"]');
  const paint = (val) => {
    inp.value = val;
    box.querySelectorAll("[data-tcat]").forEach((b) => {
      const on = b.dataset.tcat === val;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on);
    });
  };
  box.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tcat]");
    if (b && box.contains(b)) paint(b.dataset.tcat);
  });
  return { reset: () => paint("task") };
}

/* Zadanie należy do konkretnego dnia zajęć (date); starsze zadania bez daty widać przy każdym terminie */
export const tasksOf = (cid, date) =>
  cache.plan.tasks
    .filter((t) => t.kind === "onsite" && t.cid === cid && (!t.date || t.date === date))
    .sort(
      (a, b) =>
        a.done - b.done ||
        (a.due ? a.due + (a.time || "") : "9").localeCompare(b.due ? b.due + (b.time || "") : "9")
    );

export const tkKey = (t) => (t.due ? t.due + (t.time || "00:00") : "9");

export function taskMeta(t) {
  if (!t.due) return "Bez terminu";
  const d = fromDK(t.due);
  return (
    "Termin: " +
    d.toLocaleDateString("pl-PL", { weekday: "short", day: "numeric", month: "short" }) +
    (t.time ? ", " + fmtT(t.time) : "") +
    (isLate(t) ? " · po terminie" : "")
  );
}

function tkRow(t) {
  const label = taskLabelOf(t);
  const exam = isExamTask(t);
  const kindTag = ui.tkView === "all" ? (t.kind === "online" ? " · Online" : " · Stacjonarne") : "";
  return (
    '<div class="tk-row' +
    (t.done ? " done" : "") +
    (isLate(t) ? " late" : "") +
    (exam ? " exam" : "") +
    '"><button type="button" class="tk-cb" role="checkbox" aria-checked="' +
    (t.done ? "true" : "false") +
    '" aria-label="Ukończone: ' +
    esc(t.text) +
    '" data-a="tg:' +
    esc(t.id) +
    '"><i>' +
    (t.done ? "✓" : "") +
    '</i></button><button type="button" class="tk-body tkopen" data-a="to:' +
    esc(t.id) +
    '"><span class="tk-tx">' +
    catChip(t) +
    esc(t.text) +
    '</span><span class="tk-meta">' +
    esc(label) +
    esc(kindTag) +
    (macOf(label) ? " · Mac: " + MAC_TXT[macOf(label)] : "") +
    " · " +
    esc(taskMeta(t)) +
    "</span></button></div>"
  );
}

function taskFilterSubjects() {
  const map = new Map();
  for (const t of cache.plan.tasks) {
    const lbl = taskLabelOf(t);
    if (lbl && lbl !== "Online" && lbl !== "Zajęcia") map.set(nameLc(lbl), lbl);
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
  $("tv-all").classList.toggle("on", ui.tkView === "all");
  $("tv-onsite").classList.toggle("on", ui.tkView === "onsite");
  $("tv-online").classList.toggle("on", ui.tkView === "online");
  $("hdBtn").setAttribute("aria-checked", ui.hideDone ? "true" : "false");

  const canAddOl = ui.tkView !== "onsite";
  const showOl = canAddOl && ui.olOpen;
  $("olBtn").hidden = !canAddOl;
  if (!ui.olAnim) {
    $("olBtn").setAttribute("aria-expanded", showOl ? "true" : "false");
    $("tkOlWrap").hidden = !showOl;
  }
  if (showOl) refreshOlForm();

  syncFilterControls();

  const byKind =
    ui.tkView === "all" ? cache.plan.tasks : cache.plan.tasks.filter((t) => t.kind === ui.tkView);
  const q = nameLc(ui.tkQuery.trim());
  const filtered = byKind.filter((t) => {
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
      const hay = nameLc(t.text) + " " + nameLc(taskLabelOf(t));
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
        : byKind.length
        ? "Wszystkie zadania są ukończone (ukryte)."
        : ui.tkView === "online"
        ? "Brak zadań online. Stuknij „+ Dodaj online”, aby dodać pierwsze."
        : ui.tkView === "onsite"
        ? "Brak zadań stacjonarnych. Dodasz je w oknie zajęć, stukając kafelek na planie."
        : "Brak zadań. Stacjonarne dodasz w oknie zajęć, a online przyciskiem „+ Dodaj online”.") +
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

export function remBind(form, kind, getEnd, isNew) {
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
    if (mode === "def") eff = ruleOf({ kind }, cache.plan.notif);
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
          let s = ruleStart(ruleOf({ kind }, cache.plan.notif), day0(end), end);
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

/* ----- Formularz zadania online ----- */
function subjPairs() {
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

function applySubject(p, val) {
  if (!val) return "";
  if (val.startsWith("n:")) {
    const n = val.slice(2);
    let s = p.subjects.find((x) => x.name.toLowerCase() === n.toLowerCase());
    if (!s) {
      s = { id: uid(), name: n, desc: "", req: "" };
      p.subjects.push(s);
    }
    return s.id;
  }
  return val;
}

const olFields = (v) =>
  '<label class="fl">Treść zadania<input name="text" maxlength="300" value="' +
  esc(v.text) +
  '" placeholder="np. Quiz na platformie, rozdział 3"></label>' +
  catPickerHtml(v.cat || "task") +
  '<label class="fl">Przedmiot<select name="subj">' +
  selOpts(subjPairs(), v.subj) +
  "</select></label>" +
  '<div class="two"><label class="fl">Termin oddania<input type="date" name="due" value="' +
  esc(v.due) +
  '"></label><label class="fl">Godzina<input type="time" name="time" value="' +
  esc(v.time) +
  '"></label></div>' +
  remHtml(v.rem) +
  '<p class="msg bad" data-err role="alert"></p>';

const olEnd = (f) => () => endOf(f.elements.due.value, f.elements.time.value.trim() || "23:59");

function readOl(f, errEl, rb) {
  const E = f.elements;
  const text = E.text.value.trim();
  const due = E.due.value;
  const tv = E.time.value.trim() || "23:59";
  const err = (m, el) => {
    errEl.textContent = m;
    if (el) el.focus();
    return null;
  };
  if (!text) return err("Wpisz treść zadania.", E.text);
  if (!fromDK(due)) return err("Wybierz termin oddania (datę).", E.due);
  if (!normT(tv)) return err("Podaj poprawną godzinę.", E.time);
  const r = rb.read();
  if (!r.ok) return err(r.err, r.el);
  errEl.textContent = "";
  const cat = E.cat ? E.cat.value : "task";
  return { text, due, time: normT(tv), subj: E.subj.value, rem: r.rem, cat };
}

const tomorrowDK = () => {
  const x = new Date();
  return dk(new Date(x.getFullYear(), x.getMonth(), x.getDate() + 1));
};

let olSig = "";
let olRem = null;
let olCat = null;

export function initOlForm() {
  const box = $("tkOnlineForm");
  box.innerHTML =
    '<form id="olf" novalidate autocomplete="off">' +
    olFields({ text: "", subj: "", due: tomorrowDK(), time: "23:59", cat: "task" }) +
    '<div class="acts"><button type="submit" class="btn pri">Dodaj zadanie online</button></div></form>';
  olSig = JSON.stringify(subjPairs());
  olRem = remBind($("olf"), "online", olEnd($("olf")), true);
  olCat = bindCatPicker($("olf"));
  $("olf").onsubmit = (ev) => {
    ev.preventDefault();
    const f = $("olf");
    const v = readOl(f, f.querySelector("[data-err]"), olRem);
    if (!v) return;
    let newId = "";
    const ok = change((p) => {
      const t = {
        id: uid(),
        kind: "online",
        sid: applySubject(p, v.subj),
        cid: "",
        at: Date.now(),
        date: "",
        text: v.text,
        due: v.due,
        time: v.time,
        url: "",
        note: "",
        done: false,
      };
      if (v.cat && v.cat !== "task") t.cat = v.cat;
      if (v.rem) t.rem = v.rem;
      newId = t.id;
      p.tasks.push(t);
    }, "Dodano zadanie online");
    if (ok) {
      f.elements.text.value = "";
      olRem.reset();
      olCat.reset();
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
  if (reduced() || !w.animate) {
    w.hidden = !open;
    if (open) {
      refreshOlForm();
      $("olf").elements.text.focus();
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
    if (ui.olOpen) {
      const t = $("olf").elements.text;
      t.focus({ preventScroll: true });
    }
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
  if (olRem) olRem.update();
  const sig = JSON.stringify(subjPairs());
  if (sig === olSig) return;
  olSig = sig;
  const s = $("olf").elements.subj;
  const cur = s.value;
  s.innerHTML = selOpts(subjPairs(), cur);
}

export function openTask(id) {
  const t = cache.plan.tasks.find((x) => x.id === id);
  if (!t) return;
  if (t.kind === "onsite") {
    if (cache.plan.classes.some((c) => c.id === t.cid)) {
      app.openDetail(t.cid, t.date || t.due);
    } else {
      openOnsiteTask(id);
    }
    return;
  }
  let sv = "";
  if (t.sid && cache.plan.subjects.some((s) => s.id === t.sid)) sv = t.sid;
  ui.ctx = { tid: id, view: "oledit" };
  openSheet(
    "Zadanie online",
    '<form id="ole" novalidate autocomplete="off">' +
      olFields({ text: t.text, subj: sv, due: t.due, time: t.time || "23:59", rem: t.rem, cat: taskCat(t) }) +
      '<div class="acts"><button type="submit" class="btn pri">Zapisz</button><button type="button" class="btn" data-sh="close">Anuluj</button><button type="button" class="btn dng" data-sh="oldel">Usuń</button></div></form>'
  );
  const f = $("ole");
  const rb = remBind(f, "online", olEnd(f), false);
  bindCatPicker(f);
  f.onsubmit = (ev) => {
    ev.preventDefault();
    const v = readOl(f, f.querySelector("[data-err]"), rb);
    if (!v) return;
    const ok = change((p) => {
      const x = p.tasks.find((y) => y.id === id);
      if (x) {
        x.text = v.text;
        x.due = v.due;
        x.time = v.time;
        x.sid = applySubject(p, v.subj);
        if (v.cat && v.cat !== "task") x.cat = v.cat;
        else delete x.cat;
        setRem(x, v.rem);
      }
    });
    if (ok) closeSheet();
  };
}

export function openOnsiteTask(id) {
  const t = cache.plan.tasks.find((x) => x.id === id && x.kind === "onsite");
  if (!t) return;
  const cl = cache.plan.classes.find((c) => c.id === t.cid);
  const orphaned = !cl;
  ui.ctx = { tid: id, cid: t.cid, date: t.date || t.due, view: "osedit" };
  openSheet(
    "Zadanie stacjonarne",
    '<form id="ose" novalidate autocomplete="off"><p class="shsub">' +
      esc(cl ? cl.name : "Zajęcia (usunięte z planu)") +
      " · " +
      esc(taskMeta(t)) +
      '</p><label class="fl">Treść zadania<input name="text" maxlength="300" value="' +
      esc(t.text) +
      '"></label>' +
      catPickerHtml(taskCat(t)) +
      remHtml(t.rem) +
      '<p class="msg bad" data-err role="alert"></p>' +
      '<div class="acts"><button type="submit" class="btn pri">Zapisz</button><button type="button" class="btn" data-sh="osback">' +
      (orphaned ? "Anuluj" : "Wróć") +
      "</button>" +
      (orphaned ? '<button type="button" class="btn dng" data-sh="oldel">Usuń</button>' : "") +
      "</div></form>"
  );
  const f = $("ose");
  const rb = remBind(f, "onsite", () => endOf(t.due, t.time || "00:00"), false);
  bindCatPicker(f);
  f.onsubmit = (ev) => {
    ev.preventDefault();
    const text = f.elements.text.value.trim();
    const er = f.querySelector("[data-err]");
    if (!text) {
      er.textContent = "Wpisz treść zadania.";
      f.elements.text.focus();
      return;
    }
    const r = rb.read();
    if (!r.ok) {
      er.textContent = r.err;
      if (r.el) r.el.focus();
      return;
    }
    const cat = f.elements.cat ? f.elements.cat.value : "task";
    const ok = change((p) => {
      const x = p.tasks.find((y) => y.id === id);
      if (x) {
        x.text = text;
        if (cat && cat !== "task") x.cat = cat;
        else delete x.cat;
        setRem(x, r.rem);
      }
    });
    if (ok) osBack();
  };
}

export function osBack() {
  if (cache.plan.classes.some((c) => c.id === ui.ctx.cid)) app.openDetail(ui.ctx.cid, ui.ctx.date);
  else closeSheet();
}

export function toggleTask(id) {
  change((p) => {
    const t = p.tasks.find((x) => x.id === id);
    if (t) t.done = !t.done;
  });
  popCb(id);
}

export function openAlertTask(id) {
  const t = cache.plan.tasks.find((x) => x.id === id);
  if (!t) return;
  if (t.kind === "onsite" && cache.plan.classes.some((c) => c.id === t.cid)) {
    app.openDetail(t.cid, t.date || t.due);
  } else {
    openTask(id);
  }
}
