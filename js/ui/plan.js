/* ===== Widok planu zajęć: kalendarz, widok dnia, siatka tygodnia, linia postępu i edycja zajęć ===== */

import { TYPES, TYPE_PAIRS, REC_PAIRS, DOW, DOWS } from "../config.js";
import { day0, wd, same, dk, fromDK, normT, mn, fmtT, uid, endOf, overlaps } from "../core.js";
import { cache } from "../sync.js";
import { $, esc, K, reduced, isDesk, wk, pre, items, dl, dlong, t5, selOpts, ui, app } from "../state.js";
import { openSheet, closeSheet, toast, change, playGo } from "./sheet.js";
import { tasksOf, taskMeta, remHtml, remBind } from "./tasks.js";
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
      .map(
        (d) =>
          '<div class="wg-d' +
          (same(d, td) ? " td" : "") +
          '" aria-label="' +
          esc(dlong(d)) +
          '"><span>' +
          DOWS[wd(d)] +
          "</span><b>" +
          d.getDate() +
          "</b></div>"
      )
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
                b = '<span class="wst">Teraz</span>';
              } else if (x === nxItem) b = '<span class="wst nx">Następne</span>';
            } else if (st === "p" && !pre(d)) cls = " past";
          }
          const top = ((o.s - lo) / 60) * WG_H + 1;
          const h = Math.max(22, ((o.e - o.s) / 60) * WG_H - 3);
          const sh = h < 42;
          const open = tasksOf(x.id, x.date).filter((t) => !t.done);
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
            '" title="' +
            esc(tip) +
            '" aria-label="' +
            esc(aria) +
            '">' +
            (open.length ? '<i class="tkdot" aria-hidden="true"></i>' : "") +
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
  else if (it.ex) tags.push('<span class="ev warn">Zmiana tego dnia</span>');
  const open = tasksOf(it.id, it.date).filter((t) => !t.done);
  if (open.length) tags.push('<span class="ev tk"><i></i>Do zrobienia: ' + open.length + "</span>");
  const act =
    ' role="button" tabindex="0" aria-label="' +
    (ui.editMode ? "Edytuj: " : "Szczegóły i zadania: ") +
    esc(c.name) +
    (open.length ? ", nieukończone zadania: " + open.length : "") +
    '"';
  const data = it.off ? "" : ' data-s="' + mn(c.s) + '" data-e="' + mn(c.e) + '"';
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
    '"' +
    act +
    '><div class="tm">' +
    (open.length ? '<i class="tkdot" aria-hidden="true"></i>' : "") +
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

function dayHtml(d, live) {
  const it = items(d);
  if (!it.length) {
    return '<div class="free">' + (ui.editMode ? "Brak zajęć. Dodaj je przyciskiem „+”." : "Brak zajęć") + "</div>";
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
            b = '<span class="st">Teraz</span>';
          } else if (nm >= mn(x.c.e)) cls = "past";
          else if (x === nxItem) b = '<span class="st nx">Następne</span>';
        } else if (st === "p" && !pre(d)) cls = "past";
      }
      return g + card(x, cls, b);
    })
    .join("");
  return (
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
    const o = m[t.due] || (m[t.due] = { n: 0, late: t.due < t0 });
    o.n++;
  }
  return m;
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
  const live = (d) => same(d, td) && !pre(d);
  $("sub").textContent = dlong(ui.now);

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
        dt ? (dt.late ? "tk late" : "tk") : "",
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
        (dt ? ", zadań do zrobienia: " + dt.n + (dt.late ? " (po terminie)" : "") : "") +
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
      h + '<p class="mleg"><span><i></i>zadania do zrobienia</span><span><i class="late"></i>po terminie</span></p>';
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

  $("vw").innerHTML = [
    ["day", "Dzień"],
    ["week", "Cały tydzień"],
  ]
    .map((v) => '<button type="button" class="' + (ui.vw === v[0] ? "on" : "") + '" data-a="v:' + v[0] + '">' + v[1] + "</button>")
    .join("");

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
  if (!desk && ui.vw === "day") L = note + head(ui.sel, 1) + dayHtml(ui.sel, live(ui.sel));
  else {
    const mon = new Date(ui.sel.getFullYear(), ui.sel.getMonth(), ui.sel.getDate() - wd(ui.sel));
    if (desk) {
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
    } else {
      L =
        note +
        '<h2 class="hh"><span>Tydzień ' +
        wk(ui.sel) +
        "</span></h2>" +
        weekDays(mon)
          .map((d) => head(d, 0) + dayHtml(d, live(d)))
          .join("");
    }
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

  const info =
    '<div class="dt-box">' +
    (tags.length ? '<div class="dt-row">' + tags.join("") + "</div>" : "") +
    '<div class="dt-pers"><span>Prowadzący:</span> <b>' +
    esc(c.person || "brak w planie") +
    '</b></div><button type="button" class="dt-subj" data-sh="subj"><span>Wymagania i notatki przedmiotu</span><b aria-hidden="true">›</b></button></div>';

  const rows = list
    .map(
      (t) =>
        '<div class="tk-row' +
        (t.done ? " done" : "") +
        (isLate(t) ? " late" : "") +
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

/* Zmiana tylko w jednym dniu */
export function openOverride(cid, date) {
  const d = fromDK(date);
  const it = items(d).find((x) => x.id === cid);
  if (!it) return;
  ui.ctx = { cid, date };
  const c = it.c;
  openSheet(
    "Zmiana tylko w tym dniu",
    '<p class="shsub">' +
      esc(it.base.name) +
      " · " +
      esc(dlong(d)) +
      '</p><form id="of" novalidate autocomplete="off"><div class="two"><label class="fl">Od<input type="time" name="s" value="' +
      esc(c.s) +
      '"></label><label class="fl">Do<input type="time" name="e" value="' +
      esc(c.e) +
      '"></label></div><label class="fl">Sala<input name="room" maxlength="80" value="' +
      esc(c.room) +
      '"></label><label class="fl">Prowadzący<input name="person" maxlength="80" value="' +
      esc(c.person) +
      '"></label><p id="fErr" class="msg bad" role="alert"></p><div class="acts"><button type="submit" class="btn pri">Zapisz</button><button type="button" class="btn" data-sh="close">Anuluj</button>' +
      (it.ex ? '<button type="button" class="btn dng" data-sh="resetex">Cofnij zmiany tego dnia</button>' : "") +
      "</div></form>"
  );
  const f = $("of");
  const E = f.elements;
  f.onsubmit = (ev) => {
    ev.preventDefault();
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
    const ok = change((p) => {
      p.exceptions = p.exceptions.filter((x) => !(x.cid === cid && x.date === date));
      const ex = { id: uid(), cid, date };
      let any = false;
      for (const k in vals) {
        if (vals[k] !== it.base[k]) {
          ex[k] = vals[k];
          any = true;
        }
      }
      if (any) p.exceptions.push(ex);
    });
    if (ok) {
      closeSheet();
      toast("Zapisano zmianę na ten dzień");
    }
  };
}

/* Wybór zakresu zmiany po stuknięciu zajęć w trybie edycji */
export function openChooser(cid, date) {
  const base = cache.plan.classes.find((x) => x.id === cid);
  if (!base) return;
  const d = fromDK(date);
  const it = items(d).find((x) => x.id === cid) || { c: base, base, ex: null, off: false };
  ui.ctx = { cid, date };
  const b = (a, l, cl) => '<button type="button" class="btn blk' + (cl ? " " + cl : "") + '" data-sh="' + a + '">' + esc(l) + "</button>";
  let h = "";
  if (base.date) {
    h += b("edit", "Edytuj zajęcia") + b("dup", "Duplikuj") + b("del", "Usuń zajęcia", "dng");
  } else {
    h += b("edit", "Zmień w całym planie");
    if (!it.off) h += b("override", "Zmień tylko w dniu " + dl(d));
    h += it.off ? b("resetex", "Przywróć zajęcia w dniu " + dl(d)) : b("off", "Odwołaj w dniu " + dl(d));
    if (it.ex && !it.off) h += b("resetex", "Cofnij zmiany z dnia " + dl(d));
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
