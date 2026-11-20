/* ===== Widok planu zajęć: kalendarz, widok dnia, siatka tygodnia, linia postępu i edycja zajęć ===== */

import { TYPES, TYPE_PAIRS, REC_PAIRS, DOW, DOWS } from "../config.js";
import { day0, wd, same, dk, fromDK, normT, mn, fmtT, uid, endOf, overlaps, isLate, taskGroup, isExamTask, absencesOf, isAbsentOn, absenceLimit, dayOverrideOf } from "../core.js";
import { cache } from "../sync.js";
import { $, esc, K, reduced, isDesk, wk, pre, items, dl, dlong, t5, selOpts, ui, app } from "../state.js";
import { openSheet, closeSheet, toast, change, playGo } from "./sheet.js";
import { tasksOf, taskMeta, remHtml, remBind, catChip, catPickerHtml, bindCatPicker, taskLabelOf } from "./tasks.js";
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
  let hi = 960;
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
        const ovTag = ov
          ? '<span class="wg-ov" title="' +
            esc(ov.off ? ov.note || "Dzień wolny" : "Plan z " + dl(fromDK(ov.fromDate))) +
            '">' +
            esc(ov.off ? ov.note || "Wolne" : "z " + dl(fromDK(ov.fromDate))) +
            "</span>" +
            (ui.editMode ? '<button type="button" class="wg-rst" data-a="dayreset:' + key + '">Przywróć</button>' : "")
          : "";
        return (
          '<div class="wg-d' +
          (same(d, td) ? " td" : "") +
          '" aria-label="' +
          esc(dlong(d)) +
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
          const open = tasksOf(x.id, x.date).filter((t) => !t.done);
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
  const open = tasksOf(it.id, it.date).filter((t) => !t.done);
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
    '><div class="tm">' +
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
    (ui.editMode && !it.off ? '<span class="c-drag" aria-hidden="true" title="Przeciągnij, aby zmienić godzinę lub dzień">⋮⋮</span>' : "") +
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
  const txt = ov.off
    ? "<b>Dzień wolny</b>" + (ov.note ? " · " + esc(ov.note) : "")
    : "<b>Przeniesiony plan:</b> zajęcia z " + esc(dlong(fromDK(ov.fromDate)));
  const rst = ui.editMode ? '<button type="button" data-a="dayreset:' + key + '">Przywróć dzień</button>' : "";
  return '<div class="dayov"><span>' + txt + "</span>" + rst + "</div>";
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
    pills.push(
      '<button type="button" class="ah exam" data-a="tk:' +
        esc(nextExam.t.id) +
        '"><i></i><span><b>Kolokwium:</b> ' +
        esc(nextExam.t.text) +
        (sub ? " (" + esc(sub) + ")" : "") +
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
  const dots = deskM ? taskDots() : {};
  const selMon = wkStart(ui.sel);
  if (!deskM) ui.mcalOpen = false;

  const row = (rs, om) => {
    const inSel = deskM && same(rs, selMon);
    let rh = '<span class="wl">' + (pre(rs) ? "" : wk(rs)) + "</span>";
    for (let c = 0; c < 7; c++) {
      const d = new Date(rs.getFullYear(), rs.getMonth(), rs.getDate() + c);
      const dt = dots[dk(d)];
      const cl = [
        om && d.getMonth() !== om - 1 ? "out" : "",
        c > 4 ? "we" : "",
        same(d, td) ? "td" : "",
        same(d, ui.sel) ? "on" : "",
        !pre(d) && items(d).some((x) => !x.off) ? "hs" : "",
        dt ? (dt.late ? "tk late" : dt.exam ? "tk exam" : "tk") : "",
        inSel ? "wkr" : "",
        c === 0 ? "w0" : "",
        c === 6 ? "w6" : "",
      ].join(" ");
      rh +=
        '<button type="button" class="' +
        cl +
        '" data-a="s:' +
        d.getFullYear() +
        "," +
        d.getMonth() +
        "," +
        d.getDate() +
        '" aria-label="' +
        esc(dlong(d)) +
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
  $("ebar").hidden = !ui.editMode;
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

/* ----- Szczegóły zajęć i zadania stacjonarne ----- */
export function openDetail(cid, date, focus) {
  const base = cache.plan.classes.find((x) => x.id === cid);
  if (!base) return;
  const d = fromDK(date) || day0(new Date());
  const it = items(d).find((x) => x.id === cid) || { c: base, base, ex: null, off: false };
  const c = it.c;
  ui.ctx = { cid, date: dk(d), view: "detail" };
  const list = tasksOf(cid, dk(d));
  const tags = [];
  if (c.type !== "x") tags.push('<span class="ty">' + esc(TYPES[c.type]) + "</span>");
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
  const absToday = isAbsentOn(cache.plan, cid, dk(d));
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
    .map(
      (t) =>
        '<div class="tk-row' +
        (t.done ? " done" : "") +
        (isLate(t) ? " late" : "") +
        (isExamTask(t) ? " exam" : "") +
        '"><button type="button" class="tk-cb" role="checkbox" aria-checked="' +
        (t.done ? "true" : "false") +
        '" aria-label="Ukończone: ' +
        esc(t.text) +
        '" data-sh="tg:' +
        esc(t.id) +
        '"><i>' +
        (t.done ? "✓" : "") +
        '</i></button><button type="button" class="tk-body tkopen" aria-label="Edytuj zadanie: ' +
        esc(t.text) +
        '" data-sh="oe:' +
        esc(t.id) +
        '"><span class="tk-tx">' +
        catChip(t) +
        esc(t.text) +
        '</span><span class="tk-meta">' +
        esc(taskMeta(t)) +
        '</span></button><button type="button" class="tk-del" aria-label="Usuń zadanie: ' +
        esc(t.text) +
        '" data-sh="td:' +
        esc(t.id) +
        '">×</button></div>'
    )
    .join("");

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
      '<h3 class="sec">Zadania</h3>' +
      (list.length ? '<div class="tk-list">' + rows + "</div>" : '<p class="tk-empty">Brak zadań.</p>') +
      '<form id="tf" novalidate autocomplete="off"><label class="fl">Nowe zadanie<input name="text" maxlength="300" placeholder="np. Zadania 1-5 str. 40"></label>' +
      catPickerHtml("task") +
      '<p class="hint">Termin: ' +
      esc(d.toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" })) +
      ", " +
      esc(fmtT(c.s)) +
      " (dzień i godzina tych zajęć).</p>" +
      remHtml() +
      '<p id="tfErr" class="msg bad" role="alert"></p>' +
      '<div class="acts"><button type="submit" class="btn pri">Dodaj zadanie</button><button type="button" class="btn" data-sh="close">Zamknij</button></div></form>',
    focus
  );
  const f = $("tf");
  const rb = remBind(f, "onsite", () => endOf(dk(d), c.s), true);
  bindCatPicker(f);
  f.onsubmit = (ev) => {
    ev.preventDefault();
    const text = f.elements.text.value.trim();
    if (!text) {
      $("tfErr").textContent = "Wpisz treść zadania.";
      f.elements.text.focus();
      return;
    }
    const r = rb.read();
    if (!r.ok) {
      $("tfErr").textContent = r.err;
      if (r.el) r.el.focus();
      return;
    }
    const cat = f.elements.cat ? f.elements.cat.value : "task";
    const ok = change((p) => {
      const t = {
        id: uid(),
        kind: "onsite",
        sid: "",
        cid,
        at: Date.now(),
        date: dk(d),
        text,
        due: dk(d),
        time: c.s,
        url: "",
        note: "",
        done: false,
      };
      if (cat && cat !== "task") t.cat = cat;
      if (r.rem) t.rem = r.rem;
      p.tasks.push(t);
    });
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
    selOpts(TYPE_PAIRS, v.type) +
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

/* Zmiana tylko w jednym dniu (w tym jednorazowe przeniesienie na inną datę) */
export function openOverride(cid, date) {
  const d = fromDK(date);
  const it = items(d).find((x) => x.id === cid);
  if (!it) return;
  const origDate = it.origDate || date;
  ui.ctx = { cid, date, origDate };
  const c = it.c;
  const relatedTasks = cache.plan.tasks.filter(
    (t) => t.kind === "onsite" && t.cid === cid && (t.date === date || t.date === origDate) && !t.done
  );
  openSheet(
    "Zmiana jednorazowa",
    '<p class="shsub">' +
      esc(it.base.name) +
      " · " +
      esc(dlong(d)) +
      (it.movedFrom ? " (pierwotnie " + esc(dl(fromDK(it.movedFrom))) + ")" : "") +
      '</p><form id="of" novalidate autocomplete="off">' +
      '<label class="fl">Data<input type="date" name="toDate" value="' +
      esc(date) +
      '"></label>' +
      '<div class="two"><label class="fl">Od<input type="time" name="s" value="' +
      esc(c.s) +
      '"></label><label class="fl">Do<input type="time" name="e" value="' +
      esc(c.e) +
      '"></label></div><label class="fl">Sala<input name="room" maxlength="80" value="' +
      esc(c.room) +
      '"></label><label class="fl">Prowadzący<input name="person" maxlength="80" value="' +
      esc(c.person) +
      '"></label>' +
      (relatedTasks.length
        ? '<label class="chkrow"><input type="checkbox" name="moveTasks"><span>Przenieś też terminy zadań z tych zajęć (' +
          relatedTasks.length +
          ")</span></label>"
        : "") +
      '<p id="fErr" class="msg bad" role="alert"></p><div class="acts"><button type="submit" class="btn pri">Zapisz</button><button type="button" class="btn" data-sh="close">Anuluj</button>' +
      (it.ex ? '<button type="button" class="btn dng" data-sh="resetex">Cofnij zmianę jednorazową</button>' : "") +
      "</div></form>"
  );
  const f = $("of");
  const E = f.elements;
  f.onsubmit = (ev) => {
    ev.preventDefault();
    const toDate = E.toDate.value;
    if (!fromDK(toDate)) {
      $("fErr").textContent = "Wybierz poprawną datę.";
      E.toDate.focus();
      return;
    }
    const s = normT(t5(E.s.value));
    const e = normT(t5(E.e.value));
    if (!s || !e) {
      $("fErr").textContent = "Podaj godzinę rozpoczęcia i zakończenia.";
      return;
    }
    if (mn(s) >= mn(e)) {
      $("fErr").textContent = "Godzina zakończenia musi być późniejsza niż rozpoczęcia.";
      E.e.focus();
      return;
    }
    const vals = { s, e, room: E.room.value.trim(), person: E.person.value.trim() };
    const moveTasks = !!(E.moveTasks && E.moveTasks.checked);
    const ok = change((p) => {
      p.exceptions = p.exceptions.filter((x) => !(x.cid === cid && x.date === origDate));
      const ex = { id: uid(), cid, date: origDate };
      let any = false;
      if (toDate !== origDate) {
        ex.toDate = toDate;
        any = true;
      }
      for (const k in vals) {
        if (vals[k] !== it.base[k]) {
          ex[k] = vals[k];
          any = true;
        }
      }
      if (any) p.exceptions.push(ex);
      if (moveTasks) {
        for (const t of p.tasks) {
          if (t.kind === "onsite" && t.cid === cid && (t.date === date || t.date === origDate) && !t.done) {
            t.date = toDate;
            t.due = toDate;
            t.time = s;
          }
        }
      }
    }, toDate !== date ? "Przeniesiono zajęcia na " + dl(fromDK(toDate)) : "Zapisano zmianę jednorazową");
    if (ok) {
      if (toDate !== date) {
        ui.sel = fromDK(toDate);
        ui.mo = new Date(ui.sel.getFullYear(), ui.sel.getMonth(), 1);
        ui.lastFill = {};
      }
      closeSheet();
      app.render();
    }
  };
}

/* Przeniesienie / zamiana całego dnia zajęć lub oznaczenie dnia wolnego */
export function openDayMove(defaultFromDate) {
  const fromDef = defaultFromDate && fromDK(defaultFromDate) ? defaultFromDate : dk(ui.sel);
  const fd = fromDK(fromDef);
  const toDefDate = new Date(fd.getFullYear(), fd.getMonth(), fd.getDate() + (wd(fd) === 4 ? 3 : wd(fd) === 3 ? 1 : 2));
  const toDef = dk(toDefDate);

  openSheet(
    "Przenieś lub zamień dzień",
    '<p class="shsub">Dotyczy wyłącznie wybranych konkretnych dat (stały plan w pozostałych tygodniach zostaje bez zmian).</p>' +
      '<form id="dmf" novalidate autocomplete="off">' +
      '<div class="seg remseg" id="dmSeg" role="group" aria-label="Tryb zmiany dnia">' +
      '<button type="button" data-dm="overwrite" class="on" aria-pressed="true">Nadpisz dzień</button>' +
      '<button type="button" data-dm="swap" aria-pressed="false">Zamień dni</button>' +
      '<button type="button" data-dm="off" aria-pressed="false">Dzień wolny</button>' +
      "</div>" +
      '<p class="hint" id="dmHint">Zajęcia z dnia źródłowego trafią na dzień docelowy (nadpisując go), a dzień źródłowy stanie się wolny.</p>' +
      '<label class="fl"><span id="dmFromLbl">Z dnia (źródłowy)</span><input type="date" name="from" value="' +
      esc(fromDef) +
      '"></label>' +
      '<label class="fl" id="dmToWrap">Na dzień (docelowy)<input type="date" name="to" value="' +
      esc(toDef) +
      '"></label>' +
      '<label class="fl" id="dmNoteWrap" hidden>Powód (opcjonalnie)<input name="note" maxlength="120" placeholder="np. Święto, dzień rektorski"></label>' +
      '<label class="chkrow" id="dmTaskWrap" hidden><input type="checkbox" name="moveTasks"><span id="dmTaskLbl"></span></label>' +
      '<p id="dmErr" class="msg bad" role="alert"></p>' +
      '<div class="acts"><button type="submit" class="btn pri">Zastosuj</button><button type="button" class="btn" data-sh="close">Anuluj</button></div></form>'
  );

  const f = $("dmf");
  const E = f.elements;
  let mode = "overwrite";
  const hints = {
    overwrite: "Zajęcia z dnia źródłowego trafią na dzień docelowy (nadpisując go), a dzień źródłowy stanie się wolny.",
    swap: "Zajęcia z obu wybranych dni zamienią się miejscami (dzień A ↔ dzień B).",
    off: "Wszystkie zajęcia z wybranego dnia zostaną ukryte (np. święto lub dzień rektorski).",
  };

  const updateUI = () => {
    $("dmSeg").querySelectorAll("button").forEach((b) => {
      const on = b.dataset.dm === mode;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on);
    });
    $("dmHint").textContent = hints[mode];
    $("dmFromLbl").textContent = mode === "off" ? "Dzień wolny" : mode === "swap" ? "Pierwszy dzień" : "Z dnia (źródłowy)";
    $("dmToWrap").hidden = mode === "off";
    $("dmNoteWrap").hidden = mode !== "off";
    $("dmErr").textContent = "";

    const a = E.from.value;
    const b = E.to.value;
    if (mode === "off" || !fromDK(a) || !fromDK(b) || a === b) {
      $("dmTaskWrap").hidden = true;
      return;
    }
    const cnt = cache.plan.tasks.filter(
      (t) => t.kind === "onsite" && !t.done && (t.date === a || (mode === "swap" && t.date === b))
    ).length;
    $("dmTaskWrap").hidden = !cnt;
    if (cnt) {
      $("dmTaskLbl").textContent =
        "Przenieś też terminy zadań stacjonarnych (" + cnt + ") — odznaczone zachowuje pierwotne daty";
    }
  };

  $("dmSeg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-dm]");
    if (b) {
      mode = b.dataset.dm;
      updateUI();
    }
  });
  E.from.addEventListener("change", updateUI);
  E.to.addEventListener("change", updateUI);
  updateUI();

  f.onsubmit = (ev) => {
    ev.preventDefault();
    const a = E.from.value;
    const b = E.to.value;
    if (!fromDK(a)) {
      $("dmErr").textContent = "Wybierz poprawną datę.";
      E.from.focus();
      return;
    }
    if (mode !== "off") {
      if (!fromDK(b)) {
        $("dmErr").textContent = "Wybierz poprawną datę docelową.";
        E.to.focus();
        return;
      }
      if (a === b) {
        $("dmErr").textContent = "Wybierz dwa różne dni.";
        E.to.focus();
        return;
      }
    }
    const moveTasks = mode !== "off" && !!(E.moveTasks && E.moveTasks.checked);
    const note = E.note ? E.note.value.trim() : "";

    const msg =
      mode === "off"
        ? "Oznaczono " + dl(fromDK(a)) + " jako dzień wolny"
        : mode === "swap"
        ? "Zamieniono dni: " + dl(fromDK(a)) + " ↔ " + dl(fromDK(b))
        : "Przeniesiono zajęcia z " + dl(fromDK(a)) + " na " + dl(fromDK(b));

    const ok = change((p) => {
      const list = Array.isArray(p.dayOverrides) ? p.dayOverrides.filter((x) => x.date !== a && (mode === "off" || x.date !== b)) : [];
      if (mode === "off") {
        const entry = { date: a, off: true };
        if (note) entry.note = note;
        list.push(entry);
      } else if (mode === "overwrite") {
        list.push({ date: a, off: true, note: "Przeniesiono na " + dl(fromDK(b)) });
        list.push({ date: b, fromDate: a });
      } else {
        list.push({ date: a, fromDate: b });
        list.push({ date: b, fromDate: a });
      }
      p.dayOverrides = list;

      if (moveTasks) {
        for (const t of p.tasks) {
          if (t.kind !== "onsite" || t.done) continue;
          if (t.date === a) {
            t.date = b;
            t.due = b;
          } else if (mode === "swap" && t.date === b) {
            t.date = a;
            t.due = a;
          }
        }
      }
    }, msg);

    if (ok) {
      const focusD = fromDK(mode === "overwrite" ? b : a);
      ui.sel = focusD;
      ui.mo = new Date(focusD.getFullYear(), focusD.getMonth(), 1);
      ui.lastFill = {};
      closeSheet();
      app.render();
    }
  };
}

export function resetDayOverride(dateKey) {
  if (!fromDK(dateKey)) return;
  change((p) => {
    const list = Array.isArray(p.dayOverrides) ? p.dayOverrides : [];
    const cur = list.find((x) => x.date === dateKey);
    const paired = cur && cur.fromDate ? cur.fromDate : null;
    p.dayOverrides = list.filter((x) => x.date !== dateKey && (!paired || !(x.date === paired && (x.off || x.fromDate === dateKey))));
  }, "Przywrócono oryginalny plan dnia");
}

/* Wybór zakresu zmiany po stuknięciu zajęć w trybie edycji */
export function openChooser(cid, date) {
  const base = cache.plan.classes.find((x) => x.id === cid);
  if (!base) return;
  const d = fromDK(date);
  const it = items(d).find((x) => x.id === cid) || { c: base, base, ex: null, off: false };
  const origDate = it.origDate || date;
  ui.ctx = { cid, date, origDate };
  const b = (a, l, cl) => '<button type="button" class="btn blk' + (cl ? " " + cl : "") + '" data-sh="' + a + '">' + esc(l) + "</button>";
  let h = "";
  if (base.date) {
    h += b("edit", "Edytuj zajęcia") + b("dup", "Duplikuj") + b("del", "Usuń zajęcia", "dng");
  } else {
    h += b("edit", "Zmień w całym planie");
    if (!it.off) h += b("override", "Zmień lub przenieś jednorazowo (" + dl(d) + ")");
    if (!it.movedFrom) {
      h += it.off ? b("resetex", "Przywróć zajęcia w dniu " + dl(d)) : b("off", "Odwołaj w dniu " + dl(d));
    }
    if (it.ex && !it.off) h += b("resetex", it.movedFrom ? "Cofnij przeniesienie (wróć na " + dl(fromDK(it.movedFrom)) + ")" : "Cofnij zmiany z dnia " + dl(d));
    h += b("dup", "Duplikuj") + b("del", "Usuń z całego planu", "dng");
  }
  h += b("close", "Anuluj");
  const meta = [dlong(d), fmtT(it.c.s) + "–" + fmtT(it.c.e), it.c.room, it.c.person, it.off ? "odwołane" : ""]
    .filter(Boolean)
    .join(" · ");
  openSheet(base.name, '<p class="shsub">' + esc(meta) + "</p>" + h);
}

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
