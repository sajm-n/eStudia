/* ===== Szczegóły zajęć oraz formularz dodawania/edycji zajęć ===== */

import { REC_PAIRS, DOW } from "../config.js";
import { day0, wd, dk, fromDK, normT, mn, fmtT, uid, overlaps, isLate, isExamTask, isTaskDone, taskTitle, absencesOf, isAbsentOn, absenceLimit, typeLabel, typePairsOf } from "../core.js";
import { cache } from "../sync.js";
import { $, esc, items, dlong, t5, selOpts, ui, app } from "../state.js";
import { openSheet, closeSheet, change } from "./sheet.js";
import { tasksOf, taskMeta, taskHeadingHtml, taskNoteHtml, taskCheckHtml, taskFieldsHtml, bindTaskForm, subjValueForName, applySubject } from "./tasks.js";
import { macOf, macChip } from "./subjects.js";

/* ----- Szczegóły zajęć i zadania w czasie ich trwania ----- */
export function openDetail(cid, date, focus) {
  const base = cache.plan.classes.find((x) => x.id === cid);
  if (!base) return;
  const d = fromDK(date) || day0(new Date());
  const dKey = dk(d);
  const it = items(d).find((x) => x.id === cid) || { id: cid, date: dKey, c: base, base, ex: null, off: false };
  const c = it.c;
  ui.ctx = { cid, date: dKey, view: "detail" };
  const list = tasksOf(it);
  const tags = [];
  if (c.type !== "x") tags.push('<span class="ty">' + esc(typeLabel(cache.plan, c.type)) + "</span>");
  if (c.room) tags.push("<span>Sala: <b>" + esc(c.room) + "</b></span>");
  if (c.date) tags.push('<span class="ev">jednorazowo</span>');
  else if (c.weeks !== "all") tags.push('<span class="ev">Tydzień ' + esc(c.weeks) + "</span>");
  if (it.off) tags.push('<span class="ev warn">Odwołane</span>');
  else if (it.ex) tags.push('<span class="ev warn">Zmiana tego dnia</span>');
  const mc = macOf(base.name);
  if (mc) tags.push(macChip(mc));

  const absDates = absencesOf(cache.plan, cid);
  const absCount = absDates.length;
  const absLim = absenceLimit(cache.plan, base);
  const absToday = isAbsentOn(cache.plan, cid, dKey);
  const absCls = absLim !== null ? (absCount > absLim ? " bad" : absCount === absLim ? " warn" : "") : "";
  const absBar =
    '<div class="abs-bar">' +
    '<span class="abs-stat' +
    absCls +
    '">Nieobecności: ' +
    absCount +
    (absLim !== null ? " / " + absLim : "") +
    "</span>" +
    '<div class="abs-ctrl">' +
    '<button type="button" class="abs-btn' +
    (absToday ? " on" : "") +
    '" data-sh="abs:toggle" aria-pressed="' +
    absToday +
    '">' +
    (absToday ? "Nieobecny tego dnia ✓" : "Zaznacz nieobecność") +
    "</button>" +
    '<span class="abs-lim">Limit: <button type="button" data-sh="abs:dec" aria-label="Zmniejsz limit nieobecności">−</button><b>' +
    (absLim !== null ? absLim : "∞") +
    '</b><button type="button" data-sh="abs:inc" aria-label="Zwiększ limit nieobecności">+</button></span>' +
    "</div></div>";

  const info =
    '<div class="dt-box">' +
    (tags.length ? '<div class="dt-row">' + tags.join("") + "</div>" : "") +
    '<div class="dt-pers"><span>Prowadzący:</span> <b>' +
    esc(c.person || "brak w planie") +
    "</b></div>" +
    absBar +
    '<button type="button" class="dt-subj" data-sh="subj"><span>Wymagania i notatki przedmiotu</span><b aria-hidden="true">›</b></button></div>';

  const rows = list
    .map((t) => {
      const done = isTaskDone(t, ui.now, cache.plan);
      return (
        '<div class="tk-row' +
        (done ? " done" : "") +
        (isLate(t, ui.now, cache.plan) ? " late" : "") +
        (isExamTask(t) ? " exam" : "") +
        '">' +
        taskCheckHtml(t, done, 'data-sh="tg:' + esc(t.id) + '"', taskTitle(t)) +
        '<button type="button" class="tk-body tkopen" aria-label="Edytuj zadanie: ' +
        esc(taskTitle(t)) +
        '" data-sh="oe:' +
        esc(t.id) +
        '"><span class="tk-tx">' +
        taskHeadingHtml(t, { omitSubj: true }) +
        "</span>" +
        taskNoteHtml(t) +
        '<span class="tk-meta">' +
        esc(taskMeta(t)) +
        '</span></button><button type="button" class="tk-del" aria-label="Usuń zadanie: ' +
        esc(taskTitle(t)) +
        '" data-sh="td:' +
        esc(t.id) +
        '">×</button></div>'
      );
    })
    .join("");

  const defSubj = subjValueForName(base.name);

  openSheet(
    base.name,
    '<p class="shsub">' +
      esc(dlong(d)) +
      ", " +
      esc(fmtT(c.s)) +
      "–" +
      esc(fmtT(c.e)) +
      "</p>" +
      info +
      '<h3 class="sec">Zadania w czasie tych zajęć</h3>' +
      (list.length ? '<div class="tk-list">' + rows + "</div>" : '<p class="tk-empty">Brak zadań w tym terminie.</p>') +
      '<h3 class="sec">Dodaj zadanie</h3>' +
      '<form id="tf" novalidate autocomplete="off">' +
      taskFieldsHtml({ text: "", note: "", url: "", subj: defSubj, due: dKey, time: c.s, cat: "task" }) +
      '<div class="acts"><button type="submit" class="btn pri">Dodaj zadanie</button><button type="button" class="btn" data-sh="close">Zamknij</button></div></form>',
    focus
  );
  const f = $("tf");
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
    }, v.cat === "exam" ? "Dodano kolokwium" : v.cat === "session" ? "Dodano sesję" : v.cat === "report" ? "Dodano sprawozdanie" : "Dodano zadanie");
    if (ok) rerenderDetail('input[name="text"]');
  };
}

export function rerenderDetail(focus) {
  const st = $("sheet").scrollTop;
  openDetail(ui.ctx.cid, ui.ctx.date, focus);
  $("sheet").scrollTop = st;
}

/* ----- Formularz zajęć (dodawanie / edycja / duplikowanie) ----- */
function formHtml(v, canDelete) {
  return (
    '<form id="f" novalidate autocomplete="off">' +
    '<label class="fl">Nazwa<input name="name" maxlength="120" required value="' +
    esc(v.name) +
    '"></label>' +
    '<label class="fl">Rodzaj<select name="type">' +
    selOpts(typePairsOf(cache.plan), v.type) +
    "</select></label>" +
    '<label class="fl">Powtarzanie<select name="rec">' +
    selOpts(REC_PAIRS, v.rec) +
    "</select></label>" +
    '<label class="fl" data-show="rec">Dzień tygodnia<select name="wd">' +
    selOpts(
      DOW.map((n, i) => [i, n]),
      v.wd
    ) +
    "</select></label>" +
    '<label class="fl" data-show="once">Data<input type="date" name="date" value="' +
    esc(v.date) +
    '"></label>' +
    '<div class="two"><label class="fl">Od<input type="time" name="s" value="' +
    esc(v.s) +
    '"></label><label class="fl">Do<input type="time" name="e" value="' +
    esc(v.e) +
    '"></label></div>' +
    '<label class="fl">Sala<input name="room" maxlength="80" value="' +
    esc(v.room) +
    '"></label>' +
    '<label class="fl">Prowadzący<input name="person" maxlength="80" value="' +
    esc(v.person) +
    '"></label>' +
    '<p id="fErr" class="msg bad" role="alert"></p><p id="fWarn" class="msg warn" role="status"></p>' +
    '<div class="acts"><button type="submit" class="btn pri">Zapisz</button><button type="button" class="btn" data-sh="close">Anuluj</button>' +
    (canDelete ? '<button type="button" class="btn dng" data-sh="del">Usuń</button>' : "") +
    "</div></form>"
  );
}

function readForm(f) {
  const g = (n) => f.elements[n].value;
  return {
    name: g("name").trim(),
    type: g("type"),
    rec: g("rec"),
    wd: +g("wd"),
    date: g("date"),
    s: t5(g("s")),
    e: t5(g("e")),
    room: g("room").trim(),
    person: g("person").trim(),
  };
}

function validateForm(v) {
  if (!v.name) return ["Podaj nazwę zajęć.", "name"];
  const s = normT(v.s);
  const e = normT(v.e);
  if (!s || !e) return ["Podaj godzinę rozpoczęcia i zakończenia.", s ? "e" : "s"];
  if (mn(s) >= mn(e)) return ["Godzina zakończenia musi być późniejsza niż rozpoczęcia.", "e"];
  if (v.rec === "once" && !fromDK(v.date)) return ["Wybierz datę zajęć.", "date"];
  return null;
}

function buildClass(v, id) {
  const o = { id, name: v.name, type: v.type };
  if (v.rec === "once") o.date = v.date;
  else {
    o.wd = v.wd;
    o.weeks = v.rec;
  }
  o.s = normT(v.s);
  o.e = normT(v.e);
  o.room = v.room;
  o.person = v.person;
  return o;
}

export function openForm(o) {
  let v;
  let title;
  let eid = null;
  if (o.mode === "new") {
    v = { name: "", type: "l", rec: "all", wd: wd(ui.sel), date: dk(ui.sel), s: "08:00", e: "09:30", room: "", person: "" };
    title = "Nowe zajęcia";
  } else {
    const c = cache.plan.classes.find((x) => x.id === o.cid);
    if (!c) return;
    v = {
      name: c.name,
      type: c.type,
      rec: c.date ? "once" : c.weeks,
      wd: c.date ? wd(fromDK(c.date)) : c.wd,
      date: c.date || dk(ui.sel),
      s: c.s,
      e: c.e,
      room: c.room,
      person: c.person,
    };
    if (o.mode === "edit") {
      title = "Edytuj zajęcia";
      eid = c.id;
    } else title = "Duplikuj zajęcia";
  }
  ui.ctx = { cid: eid };
  openSheet(title, formHtml(v, eid !== null), o.mode === "edit" ? null : 'input[name="name"]');
  const f = $("f");
  const E = f.elements;
  const upd = () => {
    const once = E.rec.value === "once";
    f.querySelector('[data-show="rec"]').hidden = once;
    f.querySelector('[data-show="once"]').hidden = !once;
    const cur = readForm(f);
    if (!validateForm(cur)) {
      const cand = buildClass(cur, "tmp");
      const list = overlaps(cache.plan, cand, eid);
      $("fWarn").textContent = list.length
        ? "Uwaga, nakłada się z: " +
          list
            .slice(0, 3)
            .map((c) => c.name + " (" + fmtT(c.s) + "–" + fmtT(c.e) + ")")
            .join(", ") +
          (list.length > 3 ? " i inne" : "") +
          ". Możesz mimo to zapisać."
        : "";
    } else $("fWarn").textContent = "";
    $("fErr").textContent = "";
  };
  f.addEventListener("input", upd);
  f.addEventListener("change", upd);
  upd();
  f.onsubmit = (ev) => {
    ev.preventDefault();
    const cur = readForm(f);
    const err = validateForm(cur);
    if (err) {
      $("fErr").textContent = err[0];
      const el = E[err[1]];
      if (el) el.focus();
      return;
    }
    const cls = buildClass(cur, eid || uid());
    const ok = change((p) => {
      if (eid) {
        const i = p.classes.findIndex((x) => x.id === eid);
        const old = p.classes[i];
        if (old.date !== cls.date || old.wd !== cls.wd || old.weeks !== cls.weeks) {
          p.exceptions = p.exceptions.filter((x) => x.cid !== eid);
        }
        p.classes[i] = cls;
      } else p.classes.push(cls);
    }, eid ? "Zapisano zmiany" : "Dodano zajęcia");
    if (ok) {
      if (cls.date) {
        ui.sel = fromDK(cls.date);
        ui.mo = new Date(ui.sel.getFullYear(), ui.sel.getMonth(), 1);
        ui.lastFill = {};
      }
      closeSheet();
      app.render();
    }
  };
}

