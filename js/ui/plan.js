/* ===== Widok planu zajęć: kalendarz, widok dnia, siatka tygodnia, linia postępu i edycja zajęć ===== */

import { TYPES, TYPE_PAIRS, REC_PAIRS, DOW, DOWS } from "../config.js";
import { day0, wd, same, dk, fromDK, normT, mn, fmtT, uid, overlaps, isLate, taskGroup, isExamTask, taskTitle, itemsFor, tasksForClass, absencesOf, isAbsentOn, absenceLimit, dayOverrideOf, dayOverrideTarget } from "../core.js";
import { cache } from "../sync.js";
import { $, esc, K, reduced, isDesk, wk, pre, items, dl, dlong, t5, selOpts, ui, app } from "../state.js";
import { openSheet, closeSheet, toast, change, playGo } from "./sheet.js";
import { tasksOf, taskMeta, taskHeadingHtml, taskNoteHtml, taskFieldsHtml, bindTaskForm, subjValueForName, applySubject, taskLabelOf } from "./tasks.js";
import { macOf, macChip } from "./subjects.js";

const WG_H = 52;

/* Pon–pt zawsze; sobota i niedziela tylko wtedy, gdy mają zajęcia */
export function weekDays(mon) {
  return [0, 1, 2, 3, 4, 5, 6]
    .map((i) => new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i))
    .filter((d, i) => i < 5 || items(d).length);
}

/* Układa zajęcia nakładające się w czasie obok siebie (kolumny w obrębie grupy) */
function layoutDay(its) {
  const ev = its
    .map((x) => ({ x, s: mn(x.c.s), e: Math.max(mn(x.c.e), mn(x.c.s) + 15) }))
    .sort((a, b) => a.s - b.s || a.e - b.e);
  const out = [];
  const lanes = [];
  let cl = [];
  let end = -1;
  const flush = () => {
    const n = cl.reduce((m, o) => Math.max(m, o.l), 0) + 1;
    cl.forEach((o) => {
      o.n = n;
      out.push(o);
    });
    cl = [];
  };
  for (const o of ev) {
    if (o.s >= end) {
      flush();
      lanes.length = 0;
      end = -1;
    }
    let l = lanes.findIndex((le) => le <= o.s);
    if (l < 0) {
      l = lanes.length;
      lanes.push(0);
    }
    lanes[l] = o.e;
    o.l = l;
    cl.push(o);
    end = Math.max(end, o.e);
  }
  flush();
  return out;
}

function weekGrid(mon, td, nm) {
  const days = weekDays(mon);
  const per = days.map((d) => items(d));
  let lo = 480;
  let hi = ui.editMode ? 1200 : 960;
  per.forEach((a) =>
    a.forEach((x) => {
      lo = Math.min(lo, Math.floor(mn(x.c.s) / 60) * 60);
      hi = Math.max(hi, Math.ceil(Math.max(mn(x.c.e), mn(x.c.s) + 15) / 60) * 60);
    })
  );
  const H = ((hi - lo) / 60) * WG_H;
  const steps = Math.round((hi - lo) / 60);
  let lab = "";
  for (let m = lo, i = 0; m <= hi; m += 60, i++) {
    lab +=
      "<span" +
      (i === 0 ? ' class="f"' : i === steps ? ' class="l"' : "") +
      ' style="top:' +
      i * WG_H +
      'px">' +
      m / 60 +
      ":00</span>";
  }
  const head =
    '<div class="wg-h"><span></span>' +
    days
      .map((d) => {
        const key = dk(d);
        const ov = dayOverrideOf(cache.plan, key);
        const target = ov ? dayOverrideTarget(cache.plan, key) : null;
        const ovLabel = ov ? (ov.off ? ov.note || "Wolne" : "z " + dl(fromDK(ov.fromDate))) : "";
        const ovTitle = ov
          ? (ov.off ? ov.note || "Dzień wolny" : "Plan z " + dl(fromDK(ov.fromDate))) +
            (target ? " — kliknij, aby przejść do " + dl(fromDK(target)) : "")
          : "";
        const ovChip = ov
          ? target
            ? '<button type="button" class="wg-ov link" data-a="jump:' +
              target +
              '" title="' +
              esc(ovTitle) +
              '">' +
              esc(ovLabel) +
              "</button>"
            : '<span class="wg-ov" title="' + esc(ovTitle) + '">' + esc(ovLabel) + "</span>"
          : "";
        const ovTag = ov
          ? ovChip +
            (ui.editMode ? '<button type="button" class="wg-rst" data-a="dayreset:' + key + '">Przywróć</button>' : "")
          : "";
        const editAttr = ui.editMode
          ? ' data-a="daymove:' +
            key +
            '" role="button" tabindex="0" title="Kliknij, aby przenieść lub zamienić dzień (' +
            esc(dl(d)) +
            ')"'
          : "";
        return (
          '<div class="wg-d' +
          (same(d, td) ? " td" : "") +
          (ui.editMode ? " edday" : "") +
          '"' +
          editAttr +
          ' aria-label="' +
          esc(dlong(d) + (ui.editMode ? " — przenieś lub zamień dzień" : "")) +
          '"><span>' +
          DOWS[wd(d)] +
          "</span><b>" +
          d.getDate() +
          "</b>" +
          ovTag +
          "</div>"
        );
      })
      .join("") +
    "</div>";
  const cols = days
    .map((d, i) => {
      const st = same(d, td) ? "t" : d < td ? "p" : "f";
      const live = st === "t" && !pre(d);
      const act = per[i].filter((x) => !x.off);
      const nxItem = live ? act.find((x) => mn(x.c.s) > nm) : null;
      const blocks = layoutDay(per[i])
        .map((o) => {
          const x = o.x;
          const c = x.c;
          let cls = "";
          let b = "";
          if (!x.off) {
            if (live) {
              if (nm >= mn(c.e)) cls = " past";
              else if (nm >= mn(c.s)) {
                cls = " now";
                b =
                  '<span class="wst" data-cd="now" data-compact="1" data-to="' +
                  mn(c.e) +
                  '">' +
                  liveBadgeText("now", mn(c.e) - nm, true) +
                  "</span>";
              } else if (x === nxItem) {
                b =
                  '<span class="wst nx" data-cd="nx" data-compact="1" data-to="' +
                  mn(c.s) +
                  '">' +
                  liveBadgeText("nx", mn(c.s) - nm, true) +
                  "</span>";
              }
            } else if (st === "p" && !pre(d)) cls = " past";
          }
          const top = ((o.s - lo) / 60) * WG_H + 1;
          const h = Math.max(22, ((o.e - o.s) / 60) * WG_H - 3);
          const sh = h < 42;
          const open = tasksOf(x).filter((t) => !t.done);
          const hasExam = open.some(isExamTask);
          const aria =
            (ui.editMode ? "Edytuj: " : "Szczegóły i zadania: ") +
            c.name +
            ", " +
            fmtT(c.s) +
            "–" +
            fmtT(c.e) +
            (c.room ? ", " + c.room : "") +
            (c.person ? ", " + c.person : "") +
            (x.off ? ", odwołane" : "") +
            (hasExam ? ", kolokwium" : "") +
            (open.length ? ", nieukończone zadania: " + open.length : "");
          const tip =
            c.name + " · " + fmtT(c.s) + "–" + fmtT(c.e) + (c.room ? " · " + c.room : "") + (c.person ? " · " + c.person : "");
          return (
            '<div class="wb ' +
            K[c.type] +
            (x.off ? " offc" : "") +
            cls +
            (sh ? " sh" : "") +
            '" style="top:' +
            top +
            "px;height:" +
            h +
            "px;left:calc(" +
            (o.l * 100) / o.n +
            "% + 2px);width:calc(" +
            100 / o.n +
            '% - 4px)" role="button" tabindex="0" data-cid="' +
            esc(x.id) +
            '" data-date="' +
            esc(x.date) +
            '" data-orig="' +
            esc(x.origDate || x.date) +
            '" data-once="' +
            (x.base.date ? "1" : "0") +
            '" data-s="' +
            o.s +
            '" data-e="' +
            o.e +
            '" title="' +
            esc(tip) +
            '" aria-label="' +
            esc(aria) +
            '">' +
            (open.length ? '<i class="tkdot' + (hasExam ? " exam" : "") + '" aria-hidden="true"></i>' : "") +
            '<div class="wb-top"><b>' +
            esc(fmtT(c.s)) +
            "–" +
            esc(fmtT(c.e)) +
            "</b>" +
            b +
            '</div><span class="wn">' +
            esc(c.name) +
            "</span>" +
            (c.room ? '<span class="wr">' + esc(c.room) + "</span>" : "") +
            (c.person && h >= 64 ? '<span class="wp">' + esc(c.person) + "</span>" : "") +
            (ui.editMode ? '<span class="wb-rz" aria-hidden="true"></span>' : "") +
            "</div>"
          );
        })
        .join("");
      const line =
        live && nm >= lo && nm <= hi
          ? '<div class="wg-now" style="top:' + ((nm - lo) / 60) * WG_H + 'px" aria-hidden="true"></div>'
          : "";
      return (
        '<div class="wg-c' +
        (st === "t" ? " td" : "") +
        '" data-date="' +
        dk(d) +
        '" data-lo="' +
        lo +
        '" data-hi="' +
        hi +
        '" style="height:' +
        H +
        'px">' +
        blocks +
        line +
        "</div>"
      );
    })
    .join("");
  return (
    '<div class="wg" style="--n:' +
    days.length +
    ";--hh:" +
    WG_H +
    'px">' +
    head +
    '<div class="wg-b"><div class="wg-t" style="height:' +
    H +
    'px">' +
    lab +
    "</div>" +
    cols +
    "</div></div>"
  );
}

function card(it, cls, badge) {
  const c = it.c;
  const tags = [];
  if (c.date) tags.push('<span class="ev">jednorazowo</span>');
  else if (c.weeks !== "all") tags.push('<span class="ev">co 2 tyg.</span>');
  if (it.off) tags.push('<span class="ev warn">Odwołane</span>');
  else if (it.movedFrom) tags.push('<span class="ev warn">Przeniesione z ' + esc(dl(fromDK(it.movedFrom))) + "</span>");
  else if (it.ex) tags.push('<span class="ev warn">Zmiana tego dnia</span>');
  if (isAbsentOn(cache.plan, it.id, it.date)) tags.push('<span class="ev warn">Nieobecność</span>');
  const open = tasksOf(it).filter((t) => !t.done);
  const hasExam = open.some(isExamTask);
  if (hasExam) tags.push('<span class="ev exam"><i></i>Kolokwium</span>');
  if (open.length) tags.push('<span class="ev tk"><i></i>Do zrobienia: ' + open.length + "</span>");
  const act =
    ' role="button" tabindex="0" aria-label="' +
    (ui.editMode ? "Edytuj: " : "Szczegóły i zadania: ") +
    esc(c.name) +
    (hasExam ? ", kolokwium" : "") +
    (open.length ? ", nieukończone zadania: " + open.length : "") +
    '"';
  const data = ' data-s="' + mn(c.s) + '" data-e="' + mn(c.e) + '"';
  return (
    '<div class="c ' +
    K[c.type] +
    (it.off ? " offc" : "") +
    (cls ? " " + cls : "") +
    '"' +
    data +
    ' data-cid="' +
    esc(it.id) +
    '" data-date="' +
    esc(it.date) +
    '" data-orig="' +
    esc(it.origDate || it.date) +
    '" data-once="' +
    (it.base.date ? "1" : "0") +
    '"' +
    act +
    '>' +
    (ui.editMode && !it.off ? '<div class="c-drag" aria-hidden="true" title="Przytrzymaj uchwyt, aby przesunąć"><i></i></div>' : "") +
    '<div class="tm">' +
    (open.length ? '<i class="tkdot' + (hasExam ? " exam" : "") + '" aria-hidden="true"></i>' : "") +
    "<b>" +
    esc(fmtT(c.s)) +
    "</b><span>" +
    esc(fmtT(c.e)) +
    '</span></div><div class="bd"><div class="nm">' +
    esc(c.name) +
    '</div><div class="mt">' +
    (c.type !== "x" ? '<span class="ty">' + esc(TYPES[c.type]) + "</span>" : "") +
    (c.room ? "<span>" + esc(c.room) + "</span>" : "") +
    (c.person ? "<span>" + esc(c.person) + "</span>" : "") +
    tags.join("") +
    "</div></div>" +
    badge +
    "</div>"
  );
}

const fmt = (m) => {
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? (r ? h + " h " + r + " min" : h + " h") : r + " min";
};

function gap(a, b) {
  const g = mn(b.c.s) - mn(a.c.e);
  if (g <= 20) return "";
  const h = Math.min(120, Math.max(34, g * 0.6));
  return (
    '<div class="gp"><div class="gl"><i></i><u style="height:' +
    h +
    'px"></u><i></i></div><div class="gt">Okienko <b>' +
    fmt(g) +
    "</b><br>" +
    esc(fmtT(a.c.e)) +
    "–" +
    esc(fmtT(b.c.s)) +
    "</div></div>"
  );
}

function fmtLeft(mins) {
  if (mins <= 0) return "< 1 min";
  const h = Math.floor(mins / 60);
  const r = mins % 60;
  return h ? (r ? h + " h " + r + " min" : h + " h") : r + " min";
}

function liveBadgeText(kind, diffMin, compact) {
  if (kind === "now") {
    return compact ? "Teraz · " + fmtLeft(diffMin) : "Teraz · koniec za " + fmtLeft(diffMin);
  }
  if (compact) return diffMin <= 180 ? "za " + fmtLeft(diffMin) : "Następne";
  return "Następne · za " + fmtLeft(diffMin);
}

let lastLiveSig = "";

function computeLiveSig(now) {
  const td = day0(now);
  if (pre(td)) return "pre";
  const nm = now.getHours() * 60 + now.getMinutes();
  const act = items(td).filter((x) => !x.off);
  const nx = act.find((x) => mn(x.c.s) > nm);
  return (
    dk(td) +
    "|" +
    act
      .map((x) => {
        const s = mn(x.c.s);
        const e = mn(x.c.e);
        const st = nm >= e ? "p" : nm >= s ? "n" : x === nx ? "x" : "f";
        return x.id + ":" + st;
      })
      .join(",")
  );
}

/* Lekkie odświeżanie co minutę: aktualizuje liczniki i linię czasu bez przebudowy całego DOM */
export function tickClock() {
  ui.now = new Date();
  const sig = computeLiveSig(ui.now);
  if (sig !== lastLiveSig) {
    lastLiveSig = sig;
    renderPlan();
    updateProgress();
    return true;
  }
  const nm = ui.now.getHours() * 60 + ui.now.getMinutes();
  document.querySelectorAll("#list [data-cd]").forEach((el) => {
    const to = +el.dataset.to;
    const compact = el.dataset.compact === "1";
    el.textContent = liveBadgeText(el.dataset.cd, to - nm, compact);
  });
  updateProgress();
  return false;
}

function dayOverrideBanner(d) {
  const key = dk(d);
  const ov = dayOverrideOf(cache.plan, key);
  if (!ov) return "";
  const target = dayOverrideTarget(cache.plan, key);
  const txt = ov.off
    ? "<b>Dzień wolny</b>" + (ov.note ? " · " + esc(ov.note) : "")
    : "<b>Przeniesiony plan:</b> zajęcia z " + esc(dlong(fromDK(ov.fromDate)));
  const main = target
    ? '<button type="button" class="dayov-jump" data-a="jump:' +
      target +
      '" title="Przejdź do ' +
      esc(dl(fromDK(target))) +
      '"><span>' +
      txt +
      '</span><b aria-hidden="true">→</b></button>'
    : "<span>" + txt + "</span>";
  const rst = ui.editMode ? '<button type="button" class="dayov-rst" data-a="dayreset:' + key + '">Przywróć</button>' : "";
  return '<div class="dayov">' + main + rst + "</div>";
}

function dayHtml(d, live) {
  const ban = dayOverrideBanner(d);
  const it = items(d);
  if (!it.length) {
    const ov = dayOverrideOf(cache.plan, dk(d));
    if (ov && ov.off) return ban + '<div class="free">Brak zajęć tego dnia</div>';
    return ban + '<div class="free">' + (ui.editMode ? "Brak zajęć. Dodaj je przyciskiem „+”." : "Brak zajęć") + "</div>";
  }
  const nm = ui.now.getHours() * 60 + ui.now.getMinutes();
  const act = it.filter((x) => !x.off);
  const nxItem = live ? act.find((x) => mn(x.c.s) > nm) : null;
  const td = day0(new Date());
  const st = same(d, td) ? "t" : d < td ? "p" : "f";
  let prev = null;
  const html = it
    .map((x) => {
      let cls = "";
      let b = "";
      let g = "";
      if (!x.off) {
        g = prev ? gap(prev, x) : "";
        prev = x;
        if (live) {
          if (nm >= mn(x.c.s) && nm < mn(x.c.e)) {
            cls = "now";
            b =
              '<span class="st" data-cd="now" data-to="' +
              mn(x.c.e) +
              '">' +
              liveBadgeText("now", mn(x.c.e) - nm, false) +
              "</span>";
          } else if (nm >= mn(x.c.e)) cls = "past";
          else if (x === nxItem) {
            b =
              '<span class="st nx" data-cd="nx" data-to="' +
              mn(x.c.s) +
              '">' +
              liveBadgeText("nx", mn(x.c.s) - nm, false) +
              "</span>";
          }
        } else if (st === "p" && !pre(d)) cls = "past";
      }
      return g + card(x, cls, b);
    })
    .join("");
  return (
    ban +
    '<div class="tl" data-k="' +
    d.getFullYear() +
    "-" +
    d.getMonth() +
    "-" +
    d.getDate() +
    '" data-st="' +
    st +
    '"><div class="rail" aria-hidden="true"><i class="fill"></i></div><div class="tlc">' +
    html +
    "</div></div>"
  );
}

/* Dni z nieukończonymi zadaniami – kropki w kalendarzu miesiąca */
function taskDots() {
  const m = {};
  const t0 = dk(day0(new Date()));
  for (const t of cache.plan.tasks) {
    if (t.done || !t.due) continue;
    const o = m[t.due] || (m[t.due] = { n: 0, late: t.due < t0, exam: false });
    o.n++;
    if (isExamTask(t)) o.exam = true;
  }
  return m;
}

/* Pasek podsumowania „Co przede mną” (najbliższe kolokwium, zaległe, najbliższe 7 dni) */
function renderAhead() {
  const box = $("ahead");
  if (!box) return;
  const td = day0(ui.now);
  let over = 0;
  let soon7 = 0;
  let nextExam = null;
  let nextExamDiff = Infinity;

  for (const t of cache.plan.tasks) {
    if (t.done) continue;
    const g = taskGroup(t, ui.now);
    if (g === "over") over++;
    else if (g === "today" || g === "tomorrow" || g === "afterTomorrow" || g === "week") soon7++;
    if (t.due && isExamTask(t)) {
      const d = fromDK(t.due);
      if (d) {
        const diff = Math.round((d - td) / 864e5);
        if (diff >= 0 && diff < nextExamDiff) {
          nextExamDiff = diff;
          nextExam = { t, diff, d };
        }
      }
    }
  }

  const pills = [];
  if (nextExam) {
    const when =
      nextExam.diff === 0
        ? "dziś"
        : nextExam.diff === 1
        ? "jutro"
        : nextExam.diff === 2
        ? "pojutrze"
        : "za " + nextExam.diff + " dni";
    const sub = taskLabelOf(nextExam.t);
    const exText = (nextExam.t.text || "").trim();
    const exMain = exText ? exText + (sub ? " (" + sub + ")" : "") : sub || (nextExam.t.note || "").split("\n")[0].slice(0, 40) || "zbliża się";
    pills.push(
      '<button type="button" class="ah exam" data-a="exams:"><i></i><span><b>Kolokwium:</b> ' +
        esc(exMain) +
        " · " +
        when +
        "</span></button>"
    );
  }
  if (over > 0) {
    pills.push(
      '<button type="button" class="ah over" data-a="goTasks:over"><i></i><span><b>Zaległe:</b> ' +
        over +
        "</span></button>"
    );
  }
  if (soon7 > 0) {
    const word = soon7 === 1 ? "zadanie" : soon7 >= 2 && soon7 <= 4 ? "zadania" : "zadań";
    pills.push(
      '<button type="button" class="ah" data-a="goTasks:all"><i></i><span><b>Najbliższe 7 dni:</b> ' +
        soon7 +
        " " +
        word +
        "</span></button>"
    );
  }
  box.hidden = !pills.length;
  box.innerHTML = pills.join("");
}

export function posMcal() {
  const m = $("mini");
  if (!m || m.hidden || !isDesk()) return;
  const btn = ui.mcalAnchor === "sub" || ui.tab !== "plan" ? $("sub") : $("wkBtn") || $("sub");
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  const w = 278;
  const h = m.offsetHeight || 310;
  const left = Math.max(12, Math.min(innerWidth - w - 12, r.left));
  const top = r.bottom + 6 + h > innerHeight && r.top - 6 - h > 8 ? r.top - 6 - h : r.bottom + 6;
  m.style.left = left + "px";
  m.style.top = top + "px";
}

export function renderPlan() {
  const td = day0(ui.now);
  lastLiveSig = computeLiveSig(ui.now);
  const live = (d) => same(d, td) && !pre(d);
  $("sub").textContent = dlong(ui.now);
  renderAhead();

  const y = ui.mo.getFullYear();
  const m = ui.mo.getMonth();
  const hdr = DOWS.map((s) => '<span class="hd">' + s + "</span>").join("");
  const wkStart = (d) => {
    const x = day0(d);
    x.setDate(x.getDate() - wd(x));
    return x;
  };
  const deskM = isDesk();
  const dots = taskDots();
  const selMon = wkStart(ui.sel);
  if (!deskM) ui.mcalOpen = false;

  const row = (rs, om) => {
    const inSel = deskM && same(rs, selMon);
    let rh = '<span class="wl">' + (pre(rs) ? "" : wk(rs)) + "</span>";
    for (let c = 0; c < 7; c++) {
      const d = new Date(rs.getFullYear(), rs.getMonth(), rs.getDate() + c);
      const dKey = dk(d);
      const dt = dots[dKey];
      const isSel = same(d, ui.sel);
      const editActiveDay = !deskM && ui.editMode && isSel;
      const cl = [
        om && d.getMonth() !== om - 1 ? "out" : "",
        c > 4 ? "we" : "",
        same(d, td) ? "td" : "",
        isSel ? "on" : "",
        editActiveDay ? "edday" : "",
        !pre(d) && items(d).some((x) => !x.off) ? "hs" : "",
        dt ? (dt.late ? "tk late" : dt.exam ? "tk exam" : "tk") : "",
        inSel ? "wkr" : "",
        c === 0 ? "w0" : "",
        c === 6 ? "w6" : "",
      ].join(" ");
      const act = editActiveDay
        ? "daymove:" + dKey
        : "s:" + d.getFullYear() + "," + d.getMonth() + "," + d.getDate();
      rh +=
        '<button type="button" class="' +
        cl +
        '" data-day="' +
        dKey +
        '" data-a="' +
        act +
        '" aria-label="' +
        esc(dlong(d) + (editActiveDay ? " — przenieś lub zamień dzień" : "")) +
        (dt ? ", zadań do zrobienia: " + dt.n + (dt.exam ? " (kolokwium)" : "") + (dt.late ? " (po terminie)" : "") : "") +
        '">' +
        d.getDate() +
        "</button>";
    }
    return rh;
  };

  let h;
  if (ui.calOpen || deskM) {
    const start = wkStart(new Date(y, m, 1));
    h =
      '<div class="ch"><button type="button" data-a="m:-1" aria-label="Poprzedni miesiąc">‹</button><b>' +
      esc(ui.mo.toLocaleDateString("pl-PL", { month: "long", year: "numeric" })) +
      '</b><button type="button" data-a="m:1" aria-label="Następny miesiąc">›</button></div><div class="cg"><span class="hd"></span>' +
      hdr;
    for (let r = 0; r < 6; r++) {
      const rs = new Date(start.getFullYear(), start.getMonth(), start.getDate() + r * 7);
      if (r > 0 && rs.getMonth() !== m) break;
      h += row(rs, m + 1);
    }
    h += "</div>";
  } else {
    const rs = wkStart(ui.sel);
    const re = new Date(rs.getFullYear(), rs.getMonth(), rs.getDate() + 6);
    h =
      '<div class="ch"><button type="button" data-a="wk:-1" aria-label="Poprzedni tydzień">‹</button><b>' +
      esc(dl(rs)) +
      " – " +
      esc(dl(re)) +
      '</b><button type="button" data-a="wk:1" aria-label="Następny tydzień">›</button></div><div class="cg"><span class="hd"></span>' +
      hdr +
      row(rs, 0) +
      "</div>";
  }

  if (deskM) {
    $("mini").innerHTML =
      h +
      '<p class="mleg"><span><i></i>zadania</span><span><i class="exam"></i>kolokwium</span><span><i class="late"></i>po terminie</span></p>';
    $("mini").hidden = !ui.mcalOpen;
    $("cal").innerHTML = "";
  } else {
    h +=
      '<button type="button" class="cx" data-a="cal:" aria-label="' +
      (ui.calOpen ? "Zwiń" : "Rozwiń") +
      ' kalendarz">' +
      (ui.calOpen ? "⌃" : "⌄") +
      "</button>";
    $("cal").innerHTML = h;
    $("mini").innerHTML = "";
    $("mini").hidden = true;
  }

  const start = fromDK(cache.plan.start);
  const note = pre(ui.sel)
    ? '<p class="sub" style="text-transform:none">Przed ' + esc(dl(start)) + " pokazuję podgląd planu z tygodnia " + wk(ui.sel) + ".</p>"
    : "";
  const desk = isDesk();
  const nb = (a, l) =>
    '<button type="button" class="navb" data-a="' + a + '" aria-label="' + l + '">' + (a.slice(-2) === "-1" ? "‹" : "›") + "</button>";
  const head = (d, w) =>
    '<h2 class="hh"><span' +
    (desk && w ? ' class="hdn">' + nb("dy:-1", "Poprzedni dzień") : ">") +
    esc(DOW[wd(d)]) +
    ", " +
    esc(dl(d)) +
    (desk && w ? nb("dy:1", "Następny dzień") : "") +
    "</span>" +
    (w ? "<em>Tydzień " + wk(d) + "</em>" : "") +
    "</h2>";

  let L;
  if (!desk) {
    L = note + head(ui.sel, 1) + dayHtml(ui.sel, live(ui.sel));
  } else {
    const mon = new Date(ui.sel.getFullYear(), ui.sel.getMonth(), ui.sel.getDate() - wd(ui.sel));
    const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
    L =
      note +
      '<h2 class="hh wkh" style="align-items:center"><span class="hdn">' +
      nb("wk:-1", "Poprzedni tydzień") +
      '<button type="button" class="wkbtn" id="wkBtn" data-a="mcal:wk" aria-expanded="' +
      (ui.mcalOpen && ui.mcalAnchor === "wk" ? "true" : "false") +
      '" aria-haspopup="dialog" title="Pokaż kalendarz miesiąca"><span>Tydzień ' +
      wk(ui.sel) +
      " · " +
      esc(dl(mon)) +
      " – " +
      esc(dl(sun)) +
      '</span><i aria-hidden="true">▾</i></button>' +
      nb("wk:1", "Następny tydzień") +
      '</span><button type="button" class="today" data-a="today:">Dzisiaj</button></h2>' +
      weekGrid(mon, td, ui.now.getHours() * 60 + ui.now.getMinutes());
  }
  $("list").innerHTML = L;
  if (desk) $("sub").setAttribute("aria-expanded", ui.mcalOpen && ui.mcalAnchor === "sub" ? "true" : "false");
  else $("sub").removeAttribute("aria-expanded");
  if (ui.mcalOpen) posMcal();
  document.body.classList.toggle("edit", ui.editMode);
  $("ed").textContent = ui.editMode ? "Gotowe" : "Edytuj";
  $("ed").setAttribute("aria-pressed", ui.editMode ? "true" : "false");
  $("fab").hidden = !ui.editMode;

  const sw = cache.plan.startWeek;
  const ow = sw === "A" ? "B" : "A";
  $("note").textContent =
    "Tydzień " + sw + " zaczyna się " + dl(start) + ", kolejne tygodnie zmieniają się na przemian (" + sw + ", " + ow + ", " + sw + "…).";
}

export function updateProgress() {
  const d = new Date();
  const nm = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  document.querySelectorAll("#list .tl").forEach((tl) => {
    const f = tl.querySelector(".fill");
    const cs = [...tl.querySelectorAll(".c[data-s]")];
    if (!f || !cs.length) return;
    const a = [];
    cs.forEach((c) => {
      a.push([+c.dataset.s, c.offsetTop], [+c.dataset.e, c.offsetTop + c.offsetHeight]);
    });
    const end = a[a.length - 1][1];
    const st = tl.dataset.st;
    const k = tl.dataset.k;
    let y = st === "p" ? end : 0;
    let live = false;
    if (st === "t") {
      if (nm >= a[a.length - 1][0]) y = end;
      else if (nm > a[0][0]) {
        for (let i = 1; i < a.length; i++) {
          if (nm <= a[i][0]) {
            const p = a[i - 1];
            const q = a[i];
            y = p[1] + (q[1] - p[1]) * (q[0] === p[0] ? 1 : (nm - p[0]) / (q[0] - p[0]));
            break;
          }
        }
        live = true;
      }
    }
    if (!f.dataset.i) {
      f.dataset.i = "1";
      f.style.transition = "none";
      f.style.height = Math.min(ui.lastFill[k] || 0, end) + "px";
      void f.offsetHeight;
      f.style.transition = "";
    }
    f.style.height = y + "px";
    ui.lastFill[k] = y;
    f.classList.toggle("live", live);
  });
  document.querySelectorAll("#list .wg-c.td").forEach((col) => {
    const lo = +col.dataset.lo;
    const hi = +col.dataset.hi;
    const ln = col.querySelector(".wg-now");
    if (ln && nm >= lo && nm <= hi) ln.style.top = ((nm - lo) / 60) * WG_H + "px";
  });
}

/* Arkusze szczegółów, edycji zajęć i przenoszenia dni wydzielone do osobnych modułów */
export { openDetail, rerenderDetail, openForm } from "./classDetail.js";
export { openOverride, openDayMove, resetDayOverride, openChooser } from "./dayMove.js";

/* ----- Nawigacja w kalendarzu ----- */
export function toggleCal() {
  const c = $("cal");
  const h0 = c.getBoundingClientRect().height;
  ui.calOpen = !ui.calOpen;
  app.render();
  if (!c.animate || reduced()) return;
  const h1 = c.getBoundingClientRect().height;
  c.style.overflow = "hidden";
  const a = c.animate([{ height: h0 + "px" }, { height: h1 + "px" }], {
    duration: 320,
    easing: "cubic-bezier(.2,.8,.2,1)",
  });
  a.onfinish = a.oncancel = () => {
    c.style.overflow = "";
  };
  [...c.children].forEach((el) =>
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, delay: 60, easing: "ease-out", fill: "backwards" })
  );
}

export function shiftDay(n) {
  ui.lastFill = {};
  ui.sel = new Date(ui.sel.getFullYear(), ui.sel.getMonth(), ui.sel.getDate() + n);
  ui.mo = new Date(ui.sel.getFullYear(), ui.sel.getMonth(), 1);
  app.render();
  playGo();
}

export function goToday() {
  ui.lastFill = {};
  ui.sel = day0(new Date());
  ui.mo = new Date(ui.sel.getFullYear(), ui.sel.getMonth(), 1);
  app.render();
  playGo();
}

export function shiftWeek(n) {
  ui.lastFill = {};
  const mon = new Date(ui.sel.getFullYear(), ui.sel.getMonth(), ui.sel.getDate() + 7 * n - wd(ui.sel));
  const t = day0(new Date());
  const tMon = new Date(t.getFullYear(), t.getMonth(), t.getDate() - wd(t));
  ui.sel = same(mon, tMon) ? t : mon;
  ui.mo = new Date(ui.sel.getFullYear(), ui.sel.getMonth(), 1);
  app.render();
  playGo();
  const g = document.querySelector(isDesk() ? "#mini .cg" : "#cal .cg");
  if (g && g.animate && !reduced()) {
    g.animate([{ transform: "translateX(" + n * 36 + "px)", opacity: 0.25 }, { transform: "none", opacity: 1 }], {
      duration: 200,
      easing: "ease-out",
    });
  }
}

/* Dymek podglądu zadań i zakresu kolokwiów po najechaniu na kafelek zajęć na desktopie */
let tipEl = null;
let tipCur = null;

function hideTip() {
  tipCur = null;
  if (tipEl) tipEl.hidden = true;
}

function showTip(wb) {
  if (!isDesk() || ui.shOpen || document.body.classList.contains("mob-dragging")) {
    hideTip();
    return;
  }
  const cid = wb.dataset.cid;
  const date = wb.dataset.date;
  const d = fromDK(date);
  if (!cid || !d) return;
  const it = items(d).find((x) => x.id === cid);
  if (!it) return;
  const open = tasksOf(it).filter((t) => !t.done);
  if (!open.length) {
    hideTip();
    return;
  }
  if (!tipEl) {
    tipEl = document.createElement("div");
    tipEl.className = "wb-tip";
    tipEl.setAttribute("role", "tooltip");
    tipEl.hidden = true;
    document.body.appendChild(tipEl);
  }
  tipCur = wb;
  const c = it.c;
  const sub = fmtT(c.s) + "–" + fmtT(c.e) + (c.room ? " · " + c.room : "");
  const rows = open
    .slice(0, 5)
    .map((t) => {
      const n = (t.note || "").trim().replace(/\s+/g, " ");
      return (
        '<div class="wt-item"><span class="wt-t">' +
        taskHeadingHtml(t, { omitSubj: true }) +
        "</span>" +
        (n ? '<span class="wt-n">' + esc(n) + "</span>" : "") +
        "</div>"
      );
    })
    .join("");
  const more = open.length > 5 ? '<span class="wt-n">+ ' + (open.length - 5) + " więcej…</span>" : "";
  tipEl.innerHTML = "<b>" + esc(c.name) + '</b><span class="wt-sub">' + esc(sub) + '</span><div class="wt-list">' + rows + more + "</div>";
  tipEl.hidden = false;

  const r = wb.getBoundingClientRect();
  const tw = tipEl.offsetWidth || 260;
  const th = tipEl.offsetHeight || 90;
  let left = r.right + 10;
  if (left + tw > innerWidth - 12) left = r.left - tw - 10;
  if (left < 12) left = Math.max(12, innerWidth - tw - 12);
  let top = r.top;
  if (top + th > innerHeight - 12) top = Math.max(12, innerHeight - th - 12);
  tipEl.style.left = Math.round(left) + "px";
  tipEl.style.top = Math.round(top) + "px";
}

export function initPlanTooltips() {
  const list = $("list");
  if (!list) return;
  list.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const wb = e.target.closest(".wb[data-cid]");
    if (!wb) return;
    if (wb !== tipCur) showTip(wb);
  });
  list.addEventListener("pointerout", (e) => {
    if (!tipCur) return;
    const rel = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest(".wb[data-cid]") : null;
    if (rel !== tipCur) hideTip();
  });
  list.addEventListener("pointerdown", hideTip);
  window.addEventListener("scroll", hideTip, true);
}

