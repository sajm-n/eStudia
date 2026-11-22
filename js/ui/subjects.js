/* ===== Katalog przedmiotów, wymagania, notatki i zgodność z MacBookiem ===== */

import { GROUPS, MAC_OPTS, MAC_TXT } from "../config.js";
import { uid, isLate, taskGroup, isExamTask, isTaskDone, taskSubjectName, taskTitle, absencesOf, absenceLimit, typeLabel, typeOrderIndex, normSubjName, oneOffEnded, subjectsOf } from "../core.js";
import { cache } from "../sync.js";
import { $, esc, reduced, ui } from "../state.js";
import { openSheet, change } from "./sheet.js";
import { tkKey, taskMeta, taskHeadingHtml, taskNoteHtml, taskCheckHtml } from "./tasks.js";

const FORM_LABEL = (t) => (t === "x" ? "Zajęcia" : t === "g" ? "Informacje" : typeLabel(cache.plan, t));

export function subjTasks(name) {
  const k = normSubjName(name);
  return cache.plan.tasks.filter((t) => normSubjName(taskSubjectName(cache.plan, t)) === k);
}

export function subjectList() {
  return subjectsOf(cache.plan, ui.now);
}

/* Formy zajęć przedmiotu (wykład, laboratorium, ćwiczenia…) z prowadzącymi z planu */
export function subjForms(name) {
  const k = normSubjName(name);
  const oneOffCount = new Map();
  for (const c of cache.plan.classes) {
    if (!c.date || normSubjName(c.name) !== k) continue;
    oneOffCount.set(c.type, (oneOffCount.get(c.type) || 0) + 1);
  }
  const m = new Map();
  for (const c of cache.plan.classes) {
    if (normSubjName(c.name) !== k) continue;
    const isSeries = !!c.date && (oneOffCount.get(c.type) || 0) > 1;
    if (c.date && !isSeries && oneOffEnded(c, ui.now)) continue;
    let e = m.get(c.type);
    if (!e) m.set(c.type, (e = { type: c.type, persons: [] }));
    if (c.person && !e.persons.includes(c.person)) e.persons.push(c.person);
  }
  return [...m.values()].sort((a, b) => typeOrderIndex(a.type) - typeOrderIndex(b.type) || a.type.localeCompare(b.type, "pl"));
}

export const subjRec = (name) => cache.plan.subjects.find((s) => normSubjName(s.name) === normSubjName(name)) || null;
export const hasNotes = (r) => !!(r && (r.req || r.desc || Object.keys(r.forms || {}).length));
export const macOf = (name) => {
  const r = subjRec(name);
  return r ? r.mac : "";
};

export function ensureSubject(p, name) {
  const clean = String(name || "").trim().replace(/\s+/g, " ");
  let s = p.subjects.find((x) => normSubjName(x.name) === normSubjName(clean));
  if (!s) {
    s = { id: uid(), name: clean, desc: "", req: "", forms: {}, mac: "" };
    p.subjects.push(s);
  }
  return s;
}

export const macChip = (m) => (m ? '<span class="ev mac ' + m + '">MacBook: ' + MAC_TXT[m] + "</span>" : "");

export function renderSubjects() {
  const list = subjectList();
  const box = $("sbList");
  $("sbN").textContent = list.length;
  box.className = list.length ? "" : "free";
  box.innerHTML = list.length
    ? list
        .map((e) => {
          const rec = subjRec(e.name);
          const open = subjTasks(e.name).filter((t) => !isTaskDone(t, ui.now, cache.plan)).length;
          const absByType = new Map();
          for (const c of cache.plan.classes) {
            if (normSubjName(c.name) !== normSubjName(e.name)) continue;
            const cnt = absencesOf(cache.plan, c.id).length;
            if (!cnt) continue;
            let g = absByType.get(c.type);
            if (!g) {
              g = { type: c.type, cnt: 0, lim: absenceLimit(cache.plan, c) };
              absByType.set(c.type, g);
            }
            g.cnt += cnt;
          }
          const absChips = [...absByType.values()]
            .sort((a, b) => typeOrderIndex(a.type) - typeOrderIndex(b.type) || a.type.localeCompare(b.type, "pl"))
            .map((g) => {
              const cls = g.lim !== null ? (g.cnt > g.lim ? " abs-bad" : g.cnt === g.lim ? " warn" : "") : "";
              const lbl = g.type !== "x" ? typeLabel(cache.plan, g.type).slice(0, 3) + "." : "";
              return (
                '<span class="ev' +
                cls +
                '">Nieob.' +
                (lbl ? " " + esc(lbl) : "") +
                ": " +
                g.cnt +
                (g.lim !== null ? "/" + g.lim : "") +
                "</span>"
              );
            })
            .join("");
          return (
            '<button type="button" class="sbi" data-a="sj:' +
            encodeURIComponent(e.name) +
            '"><span class="nm">' +
            esc(e.name) +
            '</span><span class="mt">' +
            e.types.map((t) => '<span class="ev">' + esc(typeLabel(cache.plan, t)) + "</span>").join("") +
            macChip(rec ? rec.mac : "") +
            (hasNotes(rec) ? '<span class="ev">Notatki</span>' : "") +
            absChips +
            (open ? '<span class="ev tk"><i></i>Do zrobienia: ' + open + "</span>" : "") +
            (e.persons.length ? '<span class="pp">' + esc(e.persons.join(", ")) + "</span>" : "") +
            '</span><b class="chev" aria-hidden="true">›</b></button>'
          );
        })
        .join("")
    : "Brak przedmiotów. Dodaj zajęcia w planie, a pojawią się tutaj.";
}

let sjT = 0;
let sjMin = 0;
const segPos = {};

/* Wsuwany wskaźnik w przełącznikach karty przedmiotu */
function slideSegs(fresh) {
  document.querySelectorAll("#shBody .seg.sl").forEach((seg) => {
    const on = seg.querySelector("button.on");
    const ind = document.createElement("i");
    ind.className = "sind";
    seg.prepend(ind);
    if (!on) {
      ind.style.display = "none";
      delete segPos[seg.dataset.k];
      return;
    }
    const k = seg.dataset.k;
    const l = on.offsetLeft;
    const w = on.offsetWidth;
    const p = fresh ? null : segPos[k];
    ind.style.width = w + "px";
    ind.style.transform = "translateX(" + l + "px)";
    if (p && ind.animate && !reduced() && (p.l !== l || p.w !== w)) {
      ind.animate(
        [
          { transform: "translateX(" + p.l + "px)", width: p.w + "px" },
          { transform: "translateX(" + l + "px)", width: w + "px" },
        ],
        { duration: 340, easing: "cubic-bezier(.34,1.3,.5,1)" }
      );
    }
    segPos[k] = { l, w };
  });
}

export function flushSave() {
  if (!ui.sjSave) return;
  clearTimeout(sjT);
  const s = ui.sjSave;
  ui.sjSave = null;
  const f = $("sjf");
  if (!f) return;
  const req = f.elements.req.value;
  const desc = f.elements.desc.value;
  const rec = subjRec(s.name);
  const cur =
    s.form === "g"
      ? rec || { req: "", desc: "" }
      : (rec && rec.forms && rec.forms[s.form]) ||
        (s.legacy && rec ? { req: rec.req, desc: rec.desc } : { req: "", desc: "" });
  if (cur.req === req.trim() && cur.desc === desc.trim()) return;
  change((p) => {
    const x = ensureSubject(p, s.name);
    if (s.form === "g") {
      x.req = req;
      x.desc = desc;
    } else {
      if (!x.forms) x.forms = {};
      if (req.trim() || desc.trim()) x.forms[s.form] = { req, desc };
      else delete x.forms[s.form];
      if (s.legacy) {
        x.req = "";
        x.desc = "";
      }
    }
  });
  const st = $("sjSt");
  if (st) st.textContent = "Zapisano ✓";
}

function sjTaskRow(t) {
  const done = isTaskDone(t, ui.now, cache.plan);
  return (
    '<div class="tk-row' +
    (done ? " done" : "") +
    (isLate(t, ui.now, cache.plan) ? " late" : "") +
    (isExamTask(t) ? " exam" : "") +
    '">' +
    taskCheckHtml(t, done, 'data-sh="stg:' + esc(t.id) + '"', taskTitle(t)) +
    '<button type="button" class="tk-body tkopen" data-sh="sto:' +
    esc(t.id) +
    '"><span class="tk-tx">' +
    taskHeadingHtml(t, { omitSubj: true }) +
    "</span>" +
    taskNoteHtml(t) +
    '<span class="tk-meta">' +
    esc(taskMeta(t)) +
    "</span></button></div>"
  );
}

export function openSubject(name, tab, focus) {
  const e = subjectList().find((x) => normSubjName(x.name) === normSubjName(name));
  if (!e) return;
  const forms = subjForms(e.name);
  const keys = forms.length ? forms.map((f) => f.type) : ["g"];
  if (tab !== "tasks" && !keys.includes(tab)) tab = keys[0];
  const all = subjTasks(e.name);
  const n = all.filter((t) => !isTaskDone(t, ui.now, cache.plan)).length;
  const rec = subjRec(e.name) || { req: "", desc: "", forms: {}, mac: "" };
  const reopen = !!ui.shOpen && ui.ctx.view === "subj" && ui.ctx.sname === e.name;
  const fresh = !reopen;
  const tabChanged = !reopen || ui.ctx.stab !== tab;
  if (fresh) sjMin = 0;
  ui.ctx = { view: "subj", sname: e.name, stab: tab };

  const tabBtn = (k, label) =>
    '<button type="button" role="tab" aria-selected="' +
    (tab === k) +
    '" class="' +
    (tab === k ? "on" : "") +
    '" data-sh="stab:' +
    k +
    '">' +
    esc(label) +
    "</button>";
  const seg =
    '<div class="seg dseg sl" data-k="d" role="tablist">' +
    keys.map((k) => tabBtn(k, FORM_LABEL(k))).join("") +
    tabBtn("tasks", "Zadania" + (n ? " (" + n + ")" : "")) +
    "</div>";
  const mac =
    '<div class="macrow"><span id="macLbl">Działa na MacBooku?</span><div class="seg macseg sl" data-k="m" role="group" aria-labelledby="macLbl">' +
    MAC_OPTS.map(
      (o) =>
        '<button type="button" class="' +
        (rec.mac === o[0] ? "on" : "") +
        '" aria-pressed="' +
        (rec.mac === o[0]) +
        '" data-sh="mac:' +
        o[0] +
        '">' +
        o[1] +
        "</button>"
    ).join("") +
    "</div></div>";

  let body;
  let sub = "";
  if (tab === "tasks") {
    const groups = GROUPS.map((g) => {
      const arr = all
        .filter((t) => taskGroup(t, ui.now, cache.plan) === g[0])
        .sort((a, b) => (g[0] === "done" ? tkKey(b).localeCompare(tkKey(a)) : tkKey(a).localeCompare(tkKey(b))));
      return arr.length
        ? '<h3 class="sec grp' +
            (g[0] === "over" ? " over" : "") +
            '">' +
            g[1] +
            " (" +
            arr.length +
            ')</h3><div class="tk-list">' +
            arr.map(sjTaskRow).join("") +
            "</div>"
        : "";
    }).join("");
    body =
      (all.length
        ? groups
        : '<p class="tk-empty">Brak zadań dla tego przedmiotu. Dodasz je poniżej albo klikając zajęcia na planie.</p>') +
      '<div class="acts"><button type="button" class="btn pri" data-sh="sjadd">+ Dodaj zadanie</button><button type="button" class="btn" data-sh="close">Zamknij</button></div>';
    sub = [
      forms.length ? forms.map((f) => FORM_LABEL(f.type)).join(" · ") : "",
      e.persons.length ? "Prowadzący: " + e.persons.join(", ") : "",
    ]
      .filter(Boolean)
      .join(" · ");
  } else {
    const f = forms.find((x) => x.type === tab);
    let v = { req: "", desc: "", legacy: false };
    if (tab === "g") v = { req: rec.req, desc: rec.desc, legacy: false };
    else if (rec.forms && rec.forms[tab]) v = { req: rec.forms[tab].req, desc: rec.forms[tab].desc, legacy: false };
    else if (tab === keys[0] && (rec.req || rec.desc) && !Object.keys(rec.forms || {}).length) {
      v = { req: rec.req, desc: rec.desc, legacy: true };
    }
    sub =
      f && f.persons.length
        ? "Prowadzący: " + f.persons.join(", ")
        : e.persons.length
        ? "Prowadzący: " + e.persons.join(", ")
        : f
        ? "Brak prowadzącego w planie"
        : "";
    body =
      '<form id="sjf" novalidate autocomplete="off"><label class="fl">Wymagania i zasady zaliczenia<textarea name="req" rows="6" maxlength="3000" placeholder="np. zasady zaliczenia, liczba i terminy kolokwiów, progi punktowe">' +
      esc(v.req) +
      '</textarea></label><label class="fl">Informacje i ustalenia z prowadzącym<textarea name="desc" rows="5" maxlength="3000" placeholder="np. kontakt do prowadzącego, konsultacje, ustalenia z zajęć">' +
      esc(v.desc) +
      '</textarea></label><p class="msg ok" id="sjSt" role="status">Zmiany zapisują się automatycznie.</p>' +
      '<div class="acts"><button type="button" class="btn" data-sh="close">Zamknij</button></div></form>';
    ui.ctx.legacy = v.legacy;
  }

  openSheet(
    e.name,
    (sub ? '<p class="shsub">' + esc(sub) + "</p>" : "") +
      mac +
      seg +
      '<div class="sjb' +
      (tabChanged && !reduced() ? " in" : "") +
      '">' +
      body +
      "</div>",
    focus
  );
  const sh = $("sheet");
  sh.classList.add("sj");
  sjMin = Math.max(sjMin, sh.offsetHeight);
  sh.style.minHeight = sjMin + "px";
  slideSegs(fresh);
  if (tab !== "tasks") {
    ui.sjSave = null;
    const f = $("sjf");
    const legacy = ui.ctx.legacy;
    const mark = () => {
      ui.sjSave = { name: e.name, form: tab, legacy };
      $("sjSt").textContent = "Zapisywanie…";
      clearTimeout(sjT);
      sjT = setTimeout(flushSave, 700);
    };
    f.addEventListener("input", mark);
    f.addEventListener("change", () => {
      if (ui.sjSave) flushSave();
    });
  }
}
