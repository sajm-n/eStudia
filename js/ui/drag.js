/* ===== Drag & Drop: Desktop (siatka tygodnia + resize 8-20 + zmiana tygodnia) i Mobile (long-press na górnym uchwycie + pełny kafelek + kalendarz/krawędzie) ===== */

import { DOW, DOWS } from "../config.js";
import { pad, wd, dk, fromDK, fmtT, uid, itemsFor, tasksForClass } from "../core.js";
import { cache } from "../sync.js";
import { $, esc, isDesk, dl, dlong, ui, app } from "../state.js";
import { openSheet, closeSheet, change } from "./sheet.js";
import { shiftWeek } from "./plan.js";

const WG_H = 52;
const SNAP = 15; // skok w minutach
const MIN_M = 480; // 08:00
const MAX_M = 1200; // 20:00
const HOVER_DELAY = 550; // ms najechania na strzałkę tygodnia
const EDGE_DELAY = 600; // ms przy krawędzi ekranu na telefonie
const HANDLE_LP_MS = 185; // ~2/3 z pierwotnych 280 ms na górnym uchwycie
const EDGE_PX = 38; // szerokość strefy krawędzi ekranu (px)

const toTime = (m) => pad(Math.floor(m / 60)) + ":" + pad(m % 60);
const snapMin = (m) => Math.round(m / SNAP) * SNAP;

/* Kolejny dzień roboczy z pomijaniem soboty (5) i niedzieli (6): Pt → Pn, Pn → Pt */
export function nextWorkday(dateObj, dir) {
  const step = dir >= 0 ? 1 : -1;
  const d = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate() + step);
  while (wd(d) >= 5) d.setDate(d.getDate() + step);
  return d;
}

let active = null;
let suppressClickUntil = 0;

export function isDragging() {
  return !!active && active.started;
}

export function shouldSuppressClick() {
  return Date.now() < suppressClickUntil;
}

/* Okno wyboru zakresu po upuszczeniu (Jednorazowo / Na stałe / Anuluj + opcjonalne zadania) */
function commitDrop(info) {
  const { cid, date, origDate, isOnce, newDate, newS, newE } = info;
  const base = cache.plan.classes.find((c) => c.id === cid);
  if (!base) return;
  const srcIt = itemsFor(cache.plan, fromDK(date)).find((x) => x.id === cid) || { id: cid, date, c: base };
  const tasks = tasksForClass(cache.plan, srcIt).filter((t) => !t.done);
  const taskIds = new Set(tasks.map((t) => t.id));

  const applyOnce = (moveTasks) => {
    const ok = change((p) => {
      if (isOnce) {
        const c = p.classes.find((x) => x.id === cid);
        if (c) {
          c.date = newDate;
          c.s = newS;
          c.e = newE;
        }
      } else {
        p.exceptions = p.exceptions.filter((x) => !(x.cid === cid && x.date === origDate));
        const ex = { id: uid(), cid, date: origDate };
        let any = false;
        if (newDate !== origDate) { ex.toDate = newDate; any = true; }
        if (newS !== base.s) { ex.s = newS; any = true; }
        if (newE !== base.e) { ex.e = newE; any = true; }
        if (any) p.exceptions.push(ex);
      }
      if (moveTasks && taskIds.size) {
        for (const t of p.tasks) {
          if (taskIds.has(t.id) && !t.done) {
            t.due = newDate;
            t.time = newS;
            if (t.date) t.date = newDate;
          }
        }
      }
    }, "Przeniesiono na " + dl(fromDK(newDate)) + ", " + fmtT(newS) + "–" + fmtT(newE));
    if (ok) {
      ui.ctx = {};
      if (newDate !== date) {
        const nd = fromDK(newDate);
        ui.sel = nd;
        ui.mo = new Date(nd.getFullYear(), nd.getMonth(), 1);
        ui.lastFill = {};
      }
      closeSheet();
      app.render();
    }
  };

  const applyPerm = (moveTasks) => {
    const newWd = wd(fromDK(newDate));
    const ok = change((p) => {
      const c = p.classes.find((x) => x.id === cid);
      if (!c) return;
      const wdChanged = c.wd !== newWd;
      c.wd = newWd;
      c.s = newS;
      c.e = newE;
      if (wdChanged) p.exceptions = p.exceptions.filter((x) => x.cid !== cid);
      if (moveTasks && taskIds.size) {
        for (const t of p.tasks) {
          if (taskIds.has(t.id) && !t.done) {
            t.due = newDate;
            t.time = newS;
            if (t.date) t.date = newDate;
          }
        }
      }
    }, "Zmieniono na stałe: " + DOW[newWd] + ", " + fmtT(newS) + "–" + fmtT(newE));
    if (ok) {
      ui.ctx = {};
      if (newDate !== date) {
        const nd = fromDK(newDate);
        ui.sel = nd;
        ui.mo = new Date(nd.getFullYear(), nd.getMonth(), 1);
        ui.lastFill = {};
      }
      closeSheet();
      app.render();
    }
  };

  /* Zajęcia jednorazowe bez zadań: zapis od razu z toastem Cofnij */
  if (isOnce && !tasks.length) {
    applyOnce(false);
    return;
  }

  const targetD = fromDK(newDate);
  const sub = esc(dlong(targetD)) + " · " + esc(fmtT(newS)) + "–" + esc(fmtT(newE));
  const taskChk = tasks.length
    ? '<label class="chkrow"><input type="checkbox" id="drgMoveTasks"><span>Przenieś też terminy zadań z tych zajęć (' +
      tasks.length +
      ")</span></label>"
    : "";

  const btns = isOnce
    ? '<button type="button" class="btn pri blk" id="drgOnce">Zapisz zmianę</button>'
    : '<button type="button" class="btn pri blk" id="drgOnce">Tylko ten raz (' +
      esc(dl(targetD)) +
      ')</button><button type="button" class="btn blk" id="drgPerm">Na stałe w całym planie (' +
      esc(DOW[wd(targetD)]) +
      ", " +
      esc(fmtT(newS)) +
      "–" +
      esc(fmtT(newE)) +
      ")</button>";

  /* Oznaczamy widok jako "drop", żeby Anuluj / kliknięcie tła / Esc w closeSheet() zawsze przywracało DOM przez app.render() */
  ui.ctx = { view: "drop" };
  openSheet(
    base.name,
    '<p class="shsub">Nowy termin: <b>' +
      sub +
      "</b></p>" +
      taskChk +
      btns +
      '<button type="button" class="btn blk" data-sh="close">Anuluj</button>'
  );

  const getMv = () => {
    const el = $("drgMoveTasks");
    return !!(el && el.checked);
  };
  const bOnce = $("drgOnce");
  if (bOnce) bOnce.onclick = () => applyOnce(getMv());
  const bPerm = $("drgPerm");
  if (bPerm) bPerm.onclick = () => applyPerm(getMv());
}

function clearHoverNav() {
  if (!active) return;
  if (active.hoverTimer) {
    clearTimeout(active.hoverTimer);
    active.hoverTimer = 0;
  }
  if (active.hoverBtn) {
    active.hoverBtn.classList.remove("drag-nav-hover");
    active.hoverBtn = null;
  }
}

function clearEdgeNav() {
  if (!active) return;
  if (active.edgeTimer) {
    clearTimeout(active.edgeTimer);
    active.edgeTimer = 0;
  }
  active.edgeDir = 0;
  if (active.edgeEl) {
    active.edgeEl.remove();
    active.edgeEl = null;
  }
}

function clearCalDayHover() {
  if (!active) return;
  if (active.calDayEl) {
    active.calDayEl.classList.remove("drag-day-over");
    active.calDayEl = null;
  }
}

function markWeekButtons(on) {
  document.querySelectorAll('#list [data-a="wk:-1"], #list [data-a="wk:1"]').forEach((b) => {
    b.classList.toggle("drag-nav-ready", on);
    if (!on) b.classList.remove("drag-nav-hover");
  });
}

function markCalReady(on) {
  const cal = $("cal");
  if (cal) cal.classList.toggle("drag-cal-ready", on);
}

function cleanup() {
  if (!active) return;
  if (active.lpTimer) {
    clearTimeout(active.lpTimer);
    active.lpTimer = 0;
  }
  if (active.handleEl) active.handleEl.classList.remove("arming");
  clearHoverNav();
  clearEdgeNav();
  clearCalDayHover();
  markWeekButtons(false);
  markCalReady(false);
  if (active.ghost) active.ghost.remove();
  if (active.dropEl) active.dropEl.remove();
  if (active.hintEl) active.hintEl.remove();
  if (active.srcEl) active.srcEl.classList.remove("drag-src", "drag-resizing");
  document.body.classList.remove("dragging", "resizing", "mob-dragging");
  active = null;
}

function createDropEl() {
  const el = document.createElement("div");
  el.className = "wb-drop";
  el.innerHTML = "<b></b><span></span>";
  return el;
}

/* ----- Desktop: ruch i zmiana rozmiaru na siatce tygodnia (ściśle w zakresie 8:00–20:00) ----- */
function updateDesktopMove(clientX, clientY) {
  if (!active) return;
  const g = active.ghost;
  g.style.left = clientX - active.offX + "px";
  g.style.top = clientY - active.offY + "px";

  const navBtns = [...document.querySelectorAll('#list [data-a="wk:-1"], #list [data-a="wk:1"]')];
  let hitBtn = null;
  for (const b of navBtns) {
    const r = b.getBoundingClientRect();
    if (clientX >= r.left - 14 && clientX <= r.right + 14 && clientY >= r.top - 14 && clientY <= r.bottom + 14) {
      hitBtn = b;
      break;
    }
  }
  if (hitBtn !== active.hoverBtn) {
    clearHoverNav();
    if (hitBtn) {
      active.hoverBtn = hitBtn;
      void hitBtn.offsetWidth;
      hitBtn.classList.add("drag-nav-hover");
      const dir = hitBtn.dataset.a === "wk:-1" ? -1 : 1;
      const fire = () => {
        if (!active || active.hoverBtn !== hitBtn) return;
        shiftWeek(dir);
        markWeekButtons(true);
        const freshBtn = document.querySelector('#list [data-a="wk:' + dir + '"]');
        active.hoverBtn = freshBtn;
        if (freshBtn) {
          void freshBtn.offsetWidth;
          freshBtn.classList.add("drag-nav-hover");
          active.hoverTimer = setTimeout(fire, HOVER_DELAY + 100);
        }
      };
      active.hoverTimer = setTimeout(fire, HOVER_DELAY);
    }
  }

  const cols = [...document.querySelectorAll("#list .wg-c[data-date]")];
  let col = null;
  for (const c of cols) {
    const r = c.getBoundingClientRect();
    if (clientX >= r.left && clientX <= r.right) {
      col = c;
      break;
    }
  }
  if (!col && cols.length) {
    const firstR = cols[0].getBoundingClientRect();
    col = clientX < firstR.left ? cols[0] : cols[cols.length - 1];
  }
  if (!col) return;

  const r = col.getBoundingClientRect();
  const lo = +col.dataset.lo;
  const hi = +col.dataset.hi;
  const relY = clientY - active.offY - r.top;
  const rawS = lo + (relY / WG_H) * 60;
  const dur = active.origE - active.origS;
  const sMin = Math.max(MIN_M, Math.min(MAX_M - dur, snapMin(rawS)));
  const eMin = sMin + dur;

  active.newDate = col.dataset.date;
  active.newS = toTime(sMin);
  active.newE = toTime(eMin);

  if (active.dropEl.parentElement !== col) col.appendChild(active.dropEl);
  const top = ((sMin - lo) / 60) * WG_H + 1;
  const h = Math.max(22, (dur / 60) * WG_H - 3);
  active.dropEl.style.top = top + "px";
  active.dropEl.style.height = h + "px";
  active.dropEl.style.display = sMin >= lo && eMin <= hi ? "" : "none";
  active.dropEl.querySelector("b").textContent = fmtT(active.newS) + "–" + fmtT(active.newE);
  active.dropEl.querySelector("span").textContent = active.name;

  const dObj = fromDK(active.newDate);
  g.querySelector(".dg-time").textContent =
    (dObj ? DOW[wd(dObj)].slice(0, 3) + " " + dObj.getDate() + " · " : "") + fmtT(active.newS) + "–" + fmtT(active.newE);
}

function updateDesktopResize(clientY) {
  if (!active || !active.colEl) return;
  const r = active.colEl.getBoundingClientRect();
  const lo = +active.colEl.dataset.lo;
  const hi = +active.colEl.dataset.hi;
  const maxEnd = Math.min(MAX_M, hi);
  const relY = clientY - r.top;
  const rawE = lo + (relY / WG_H) * 60;
  const eMin = Math.max(active.origS + 30, Math.min(maxEnd, snapMin(rawE)));
  active.newE = toTime(eMin);
  const h = Math.max(22, ((eMin - active.origS) / 60) * WG_H - 3);
  active.srcEl.style.height = h + "px";
  const bEl = active.srcEl.querySelector(".wb-top b");
  if (bEl) bEl.textContent = fmtT(active.newS) + "–" + fmtT(active.newE);
}

/* ----- Mobile: pełny przesuwany kafelek, który płynnie kurczy się do pigułki nad kalendarzem ----- */
function startMobileDrag(clientX, clientY) {
  if (!active || active.started) return;
  active.started = true;
  if (active.lpTimer) {
    clearTimeout(active.lpTimer);
    active.lpTimer = 0;
  }
  if (active.handleEl) active.handleEl.classList.remove("arming");
  try { if (navigator.vibrate) navigator.vibrate(15); } catch (e) {}

  document.body.classList.add("dragging", "mob-dragging");
  active.srcEl.classList.add("drag-src");
  markCalReady(true);

  const rect = active.srcEl.getBoundingClientRect();
  active.cardW = rect.width;
  active.cardLeft = rect.left;
  active.cardOffY = Math.min(28, Math.max(10, clientY - rect.top));

  /* Klonujemy cały kafelek zajęć, żeby przesuwał się naturalnie jak na desktopie */
  const ghost = document.createElement("div");
  ghost.className = "c " + active.typeCls + " drag-card-ghost";
  ghost.style.width = rect.width + "px";
  ghost.style.left = rect.left + "px";
  ghost.style.top = rect.top + "px";

  const tmClone = active.srcEl.querySelector(".tm");
  const bdClone = active.srcEl.querySelector(".bd");
  ghost.innerHTML =
    '<div class="dcg-full">' +
    (tmClone ? tmClone.outerHTML : "") +
    (bdClone ? bdClone.outerHTML : "") +
    "</div>" +
    '<div class="dcg-pill"><b class="dp-time"></b><span class="dp-name">' +
    esc(active.name) +
    "</span></div>";

  /* Dodaj etykietę docelowego dnia wewnątrz pełnego kafelka */
  const dayBadge = document.createElement("span");
  dayBadge.className = "dcg-day";
  ghost.querySelector(".dcg-full").appendChild(dayBadge);

  document.body.appendChild(ghost);
  active.ghost = ghost;

  const hint = document.createElement("div");
  hint.className = "drag-hint mob";
  hint.textContent = "Góra/dół: godzina (8–20) · Kalendarz lub krawędź: inny dzień";
  document.body.appendChild(hint);
  active.hintEl = hint;

  updateMobileMove(clientX, clientY);
}

function renderMobileGhost(clientX, clientY, compact) {
  if (!active || !active.ghost) return;
  const g = active.ghost;
  const dObj = fromDK(active.newDate);
  const dayLabel = dObj ? DOWS[wd(dObj)] + " " + dObj.getDate() : "";
  const timeRange = fmtT(active.newS) + "–" + fmtT(active.newE);

  /* Zaktualizuj godziny w pełnym kafelku */
  const tmB = g.querySelector(".dcg-full .tm b");
  const tmS = g.querySelector(".dcg-full .tm span");
  if (tmB) tmB.textContent = fmtT(active.newS);
  if (tmS) tmS.textContent = fmtT(active.newE);
  const dayBadge = g.querySelector(".dcg-day");
  if (dayBadge) {
    dayBadge.textContent = active.newDate !== active.date ? dayLabel : "";
    dayBadge.hidden = active.newDate === active.date;
  }

  /* Zaktualizuj pigułkę (widoczna po skurczeniu nad kalendarzem) */
  g.querySelector(".dp-time").textContent = (dayLabel ? dayLabel + " · " : "") + timeRange;
  g.classList.toggle("compact", compact);

  if (compact) {
    const pw = Math.min(250, innerWidth - 28);
    g.style.width = pw + "px";
    g.style.left = Math.max(14, Math.min(innerWidth - pw - 14, clientX - pw / 2)) + "px";
    g.style.top = Math.max(8, clientY - 62) + "px";
  } else {
    g.style.width = active.cardW + "px";
    const shiftX = Math.max(-22, Math.min(22, (clientX - active.startX) * 0.18));
    g.style.left = active.cardLeft + shiftX + "px";
    g.style.top = Math.max(12, Math.min(innerHeight - 96, clientY - active.cardOffY)) + "px";
  }
}

function showEdgeIndicator(dir, targetDate) {
  clearEdgeNav();
  if (!active) return;
  active.edgeDir = dir;
  const el = document.createElement("div");
  el.className = "drag-edge " + (dir < 0 ? "left" : "right");
  const lbl = DOWS[wd(targetDate)] + " " + targetDate.getDate();
  el.innerHTML =
    '<span class="de-arr">' +
    (dir < 0 ? "‹" : "›") +
    '</span><span class="de-day">' +
    esc(lbl) +
    '</span><i class="de-bar"></i>';
  document.body.appendChild(el);
  active.edgeEl = el;
  void el.offsetWidth;
  el.classList.add("dwell");

  const fire = () => {
    if (!active || active.edgeDir !== dir) return;
    const nextD = nextWorkday(ui.sel, dir);
    ui.lastFill = {};
    ui.sel = nextD;
    ui.mo = new Date(nextD.getFullYear(), nextD.getMonth(), 1);
    active.newDate = dk(nextD);
    app.render();
    markCalReady(true);
    try { if (navigator.vibrate) navigator.vibrate(10); } catch (e) {}
    const following = nextWorkday(nextD, dir);
    showEdgeIndicator(dir, following);
    renderMobileGhost(active.lastX || active.startX, active.lastY || active.startY, false);
  };
  active.edgeTimer = setTimeout(fire, EDGE_DELAY);
}

function updateMobileMove(clientX, clientY) {
  if (!active) return;
  active.lastX = clientX;
  active.lastY = clientY;

  /* 1. Sprawdź wyjechanie poza listę i wjechanie na kalendarz nawigacyjny (#cal) */
  const cal = $("cal");
  const calRect = cal ? cal.getBoundingClientRect() : null;
  const overCal = calRect && clientY <= calRect.bottom + 14;

  if (overCal) {
    clearEdgeNav();
    const elUnder = document.elementFromPoint(clientX, clientY);
    const dayBtn = elUnder && elUnder.closest && elUnder.closest("#cal .cg button[data-day]");
    const navBtn = elUnder && elUnder.closest && elUnder.closest("#cal .ch button[data-a]");

    if (dayBtn) {
      clearHoverNav();
      if (dayBtn !== active.calDayEl) {
        clearCalDayHover();
        active.calDayEl = dayBtn;
        dayBtn.classList.add("drag-day-over");
        active.newDate = dayBtn.dataset.day;
      }
      renderMobileGhost(clientX, clientY, true);
      return;
    }

    clearCalDayHover();
    if (navBtn !== active.hoverBtn) {
      clearHoverNav();
      if (navBtn) {
        active.hoverBtn = navBtn;
        navBtn.classList.add("drag-nav-hover");
        const act = navBtn.dataset.a;
        const fireCalNav = () => {
          if (!active || !active.hoverBtn) return;
          const [k, v] = act.split(":");
          if (k === "wk") shiftWeek(+v);
          else if (k === "m") {
            ui.mo = new Date(ui.mo.getFullYear(), ui.mo.getMonth() + +v, 1);
            app.render();
          }
          markCalReady(true);
          const fresh = document.querySelector('#cal .ch button[data-a="' + act + '"]');
          active.hoverBtn = fresh;
          if (fresh) {
            void fresh.offsetWidth;
            fresh.classList.add("drag-nav-hover");
            active.hoverTimer = setTimeout(fireCalNav, HOVER_DELAY + 100);
          }
        };
        active.hoverTimer = setTimeout(fireCalNav, HOVER_DELAY);
      }
    }
    renderMobileGhost(clientX, clientY, true);
    return;
  }

  clearCalDayHover();
  clearHoverNav();

  /* 2. Krawędzie ekranu (lewa / prawa) → przeskakiwanie dni z pomijaniem weekendów */
  const edgeDir = clientX <= EDGE_PX ? -1 : clientX >= innerWidth - EDGE_PX ? 1 : 0;
  if (edgeDir !== active.edgeDir) {
    if (edgeDir) showEdgeIndicator(edgeDir, nextWorkday(ui.sel, edgeDir));
    else clearEdgeNav();
  }

  /* 3. Pionowe przeciąganie góra/dół → zmiana godziny co 15 min (ściśle 8:00–20:00) */
  const dy = clientY - active.startY;
  const deltaMin = snapMin((dy / 16) * SNAP);
  const dur = active.origE - active.origS;
  const sMin = Math.max(MIN_M, Math.min(MAX_M - dur, active.origS + deltaMin));
  const eMin = sMin + dur;
  active.newS = toTime(sMin);
  active.newE = toTime(eMin);

  if (active.srcEl && active.srcEl.isConnected) {
    const bEl = active.srcEl.querySelector(".tm b");
    const sEl = active.srcEl.querySelector(".tm span");
    if (bEl) bEl.textContent = fmtT(active.newS);
    if (sEl) sEl.textContent = fmtT(active.newE);
  }
  renderMobileGhost(clientX, clientY, false);
}

export function initDrag() {
  const list = $("list");
  if (!list) return;

  list.addEventListener("pointerdown", (e) => {
    if (!ui.editMode || ui.shOpen || e.button !== 0) return;

    /* Desktop: .wb na siatce tygodnia */
    if (isDesk()) {
      const wb = e.target.closest(".wb[data-cid]");
      if (!wb) return;
      const isRz = !!e.target.closest(".wb-rz");
      const rect = wb.getBoundingClientRect();
      const colEl = wb.closest(".wg-c[data-date]");
      const base = cache.plan.classes.find((c) => c.id === wb.dataset.cid);
      if (!base) return;

      active = {
        platform: "desk",
        mode: isRz ? "resize" : "move",
        pointerId: e.pointerId,
        cid: wb.dataset.cid,
        name: base.name,
        typeCls: wb.classList.contains("w") ? "w" : wb.classList.contains("l") ? "l" : wb.classList.contains("c2") ? "c2" : "x",
        date: wb.dataset.date,
        origDate: wb.dataset.orig || wb.dataset.date,
        isOnce: wb.dataset.once === "1",
        origS: +wb.dataset.s,
        origE: +wb.dataset.e,
        newDate: wb.dataset.date,
        newS: toTime(+wb.dataset.s),
        newE: toTime(+wb.dataset.e),
        startX: e.clientX,
        startY: e.clientY,
        offX: e.clientX - rect.left,
        offY: e.clientY - rect.top,
        width: rect.width,
        height: rect.height,
        srcEl: wb,
        colEl,
        started: false,
        ghost: null,
        dropEl: null,
        hintEl: null,
        hoverBtn: null,
        hoverTimer: 0,
      };
      return;
    }

    /* Mobile: JEDYNIE long-press (~185 ms) na górnym, wyśrodkowanym uchwycie .c-drag */
    const handle = e.target.closest(".c-drag");
    if (!handle) return;
    const card = handle.closest(".c[data-cid]");
    if (!card || card.classList.contains("offc")) return;
    const base = cache.plan.classes.find((c) => c.id === card.dataset.cid);
    if (!base) return;

    handle.classList.add("arming");
    active = {
      platform: "mob",
      mode: "move",
      pointerId: e.pointerId,
      cid: card.dataset.cid,
      name: base.name,
      typeCls: card.classList.contains("w") ? "w" : card.classList.contains("l") ? "l" : card.classList.contains("c2") ? "c2" : "x",
      date: card.dataset.date,
      origDate: card.dataset.orig || card.dataset.date,
      isOnce: card.dataset.once === "1",
      origS: +card.dataset.s,
      origE: +card.dataset.e,
      newDate: card.dataset.date,
      newS: toTime(+card.dataset.s),
      newE: toTime(+card.dataset.e),
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      srcEl: card,
      handleEl: handle,
      started: false,
      lpTimer: 0,
      ghost: null,
      hintEl: null,
      hoverBtn: null,
      hoverTimer: 0,
      calDayEl: null,
      edgeDir: 0,
      edgeEl: null,
      edgeTimer: 0,
    };

    const sx = e.clientX;
    const sy = e.clientY;
    active.lpTimer = setTimeout(() => {
      if (active && !active.started) startMobileDrag(sx, sy);
    }, HANDLE_LP_MS);
  });

  document.addEventListener(
    "pointermove",
    (e) => {
      if (!active || e.pointerId !== active.pointerId) return;
      const dx = e.clientX - active.startX;
      const dy = e.clientY - active.startY;

      if (active.platform === "desk") {
        if (!active.started) {
          if (Math.hypot(dx, dy) < 5) return;
          active.started = true;
          if (active.mode === "move") {
            document.body.classList.add("dragging");
            active.srcEl.classList.add("drag-src");
            const g = document.createElement("div");
            g.className = "drag-ghost " + active.typeCls;
            g.style.width = Math.max(130, active.width) + "px";
            g.style.height = Math.max(44, Math.min(active.height, 96)) + "px";
            g.innerHTML = '<b class="dg-time"></b><span class="dg-name">' + esc(active.name) + "</span>";
            document.body.appendChild(g);
            active.ghost = g;
            active.dropEl = createDropEl();

            const hint = document.createElement("div");
            hint.className = "drag-hint";
            hint.textContent = "Upuść na wybraną godzinę (8–20) · ← / → lub najedź na ‹ › aby zmienić tydzień · Esc anuluje";
            document.body.appendChild(hint);
            active.hintEl = hint;
            markWeekButtons(true);
          } else {
            document.body.classList.add("resizing");
            active.srcEl.classList.add("drag-resizing");
          }
        }
        e.preventDefault();
        if (active.mode === "move") updateDesktopMove(e.clientX, e.clientY);
        else updateDesktopResize(e.clientY);
        return;
      }

      /* Mobile: przed upływem 185 ms na uchwycie ruch >12px anuluje (pozwala przewijać) */
      if (!active.started) {
        if (Math.hypot(dx, dy) > 12) cleanup();
        return;
      }
      e.preventDefault();
      updateMobileMove(e.clientX, e.clientY);
    },
    { passive: false }
  );

  document.addEventListener(
    "touchmove",
    (e) => {
      if (active && active.started && active.platform === "mob") e.preventDefault();
    },
    { passive: false }
  );

  const finish = (cancelled) => {
    if (!active) return;
    const snap = active;
    const wasStarted = snap.started;
    cleanup();
    if (!wasStarted) return;
    suppressClickUntil = Date.now() + 350;
    if (cancelled) {
      app.render();
      return;
    }
    const origSstr = toTime(snap.origS);
    const origEstr = toTime(snap.origE);
    if (snap.newDate === snap.date && snap.newS === origSstr && snap.newE === origEstr) {
      app.render();
      return;
    }
    commitDrop(snap);
  };

  document.addEventListener("pointerup", (e) => {
    if (!active || e.pointerId !== active.pointerId) return;
    finish(false);
  });

  document.addEventListener("pointercancel", (e) => {
    if (!active || e.pointerId !== active.pointerId) return;
    finish(true);
  });

  document.addEventListener(
    "keydown",
    (e) => {
      if (!active || !active.started) return;
      if (e.key === "Escape") {
        e.preventDefault();
        finish(true);
        return;
      }
      if (active.platform === "desk" && active.mode === "move" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        e.stopImmediatePropagation();
        shiftWeek(e.key === "ArrowLeft" ? -1 : 1);
        markWeekButtons(true);
      }
    },
    true
  );
}
