/* ===== Drag & Drop + klikanie w siatkę: Desktop (drag/resize 8-20, zmiana tygodnia, podgląd i dodawanie kliknięciem) i Mobile (long-press na kafelku + kalendarz/krawędzie) ===== */

import { DOW, DOWS } from "../config.js";
import { pad, wd, dk, fromDK, fmtT, uid, itemsFor, tasksForClass, isTaskDone } from "../core.js";
import { cache } from "../sync.js";
import { $, esc, isDesk, dl, dlong, ui, app } from "../state.js";
import { openSheet, closeSheet, change } from "./sheet.js";
import { shiftWeek } from "./plan.js";

const WG_H = 52;
const SNAP = 15; // skok w minutach
const ADD_DUR = 90; // domyślny czas trwania nowych zajęć po kliknięciu w siatkę (min)
const MIN_DUR = 30; // minimalny czas trwania zajęć przy rozciąganiu i dodawaniu kliknięciem (min)
const MIN_M = 480; // 08:00 (domyślna granica mobilna)
const MAX_M = 1200; // 20:00 (domyślna granica mobilna)
const DAY_MAX_M = 1425; // 23:45 — maksymalna poprawna godzina zakończenia (normT wymaga < 24:00)
const GRID_MAX_HI = 1440; // 24:00 — górna granica etykiet siatki
const HOVER_DELAY = 550; // ms najechania na strzałkę tygodnia
const EDGE_DELAY = 600; // ms przy krawędzi ekranu na telefonie
const CARD_LP_MS = 260; // czas przytrzymania (long-press) bezpośrednio na kafelku zajęć
const ARM_DELAY_MS = 70; // opóźnienie podświetlenia kafelka (żeby zwykłe stuknięcie nie mrugało)
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
  const tasks = tasksForClass(cache.plan, srcIt, ui.now).filter((t) => !isTaskDone(t, ui.now, cache.plan));
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
          if (taskIds.has(t.id) && !isTaskDone(t, ui.now, p)) {
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
          if (taskIds.has(t.id) && !isTaskDone(t, ui.now, p)) {
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
  if (active.armTimer) {
    clearTimeout(active.armTimer);
    active.armTimer = 0;
  }
  clearHoverNav();
  clearEdgeNav();
  clearCalDayHover();
  markWeekButtons(false);
  markCalReady(false);
  if (active.ghost) active.ghost.remove();
  if (active.dropEl) active.dropEl.remove();
  if (active.hintEl) active.hintEl.remove();
  if (active.srcEl) active.srcEl.classList.remove("arming", "drag-src", "drag-resizing");
  document.body.classList.remove("dragging", "resizing", "mob-dragging");
  active = null;
}

function createDropEl() {
  const el = document.createElement("div");
  el.className = "wb-drop";
  el.innerHTML = "<b></b><span></span>";
  return el;
}

/* ----- Desktop: podgląd miejsca dodania zajęć pod kursorem na siatce tygodnia ----- */
let addPreviewEl = null;

function hideAddPreview() {
  if (addPreviewEl && addPreviewEl.parentElement) addPreviewEl.remove();
}

function calcAddSlot(col, clientY) {
  const r = col.getBoundingClientRect();
  const lo = +col.dataset.lo;
  const hi = +col.dataset.hi;
  const maxEnd = Math.min(hi, DAY_MAX_M);
  const minDur = Math.min(MIN_DUR, Math.max(SNAP, maxEnd - lo));
  const relY = clientY - r.top;
  const rawS = lo + (relY / WG_H) * 60;
  const sMin = Math.max(lo, Math.min(maxEnd - minDur, Math.floor(rawS / SNAP) * SNAP));
  const eMin = Math.min(maxEnd, sMin + ADD_DUR);
  return {
    date: col.dataset.date,
    sMin,
    eMin,
    s: toTime(sMin),
    e: toTime(eMin),
    top: ((sMin - lo) / 60) * WG_H + 1,
    height: Math.max(22, ((eMin - sMin) / 60) * WG_H - 3),
  };
}

function updateAddPreview(col, clientY) {
  const slot = calcAddSlot(col, clientY);
  if (!addPreviewEl) {
    addPreviewEl = createDropEl();
    addPreviewEl.classList.add("wb-add");
  }
  if (addPreviewEl.parentElement !== col) col.appendChild(addPreviewEl);
  addPreviewEl.style.top = slot.top + "px";
  addPreviewEl.style.height = slot.height + "px";
  addPreviewEl.classList.toggle("sh", slot.height < 42);
  addPreviewEl.style.display = "";
  addPreviewEl.querySelector("b").textContent = fmtT(slot.s) + "–" + fmtT(slot.e);
  addPreviewEl.querySelector("span").textContent = "+ Nowe zajęcia";
}

function setGridHi(wg, lo, nextHi) {
  if (!wg) return;
  const H = ((nextHi - lo) / 60) * WG_H;
  const steps = Math.round((nextHi - lo) / 60);
  const tEl = wg.querySelector(".wg-t");
  if (tEl) {
    let lab = "";
    for (let m = lo, i = 0; m <= nextHi; m += 60, i++) {
      lab +=
        "<span" +
        (i === 0 ? ' class="f"' : i === steps ? ' class="l"' : "") +
        ' style="top:' +
        i * WG_H +
        'px">' +
        m / 60 +
        ":00</span>";
    }
    tEl.style.height = H + "px";
    tEl.innerHTML = lab;
  }
  wg.querySelectorAll(".wg-c[data-date]").forEach((c) => {
    c.style.height = H + "px";
    c.dataset.hi = String(nextHi);
  });
}

/* ----- Desktop: ruch po całej aktualnej siatce (bez jej rozszerzania) oraz rozciąganie z rozszerzaniem siatki ----- */
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
  const maxEnd = Math.min(hi, DAY_MAX_M);
  const relY = clientY - active.offY - r.top;
  const rawS = lo + (relY / WG_H) * 60;
  const dur = active.origE - active.origS;
  const maxS = Math.max(lo, maxEnd - dur);
  const sMin = Math.max(lo, Math.min(maxS, snapMin(rawS)));
  const eMin = Math.min(maxEnd, sMin + dur);

  active.newDate = col.dataset.date;
  active.newS = toTime(sMin);
  active.newE = toTime(eMin);

  if (active.dropEl.parentElement !== col) col.appendChild(active.dropEl);
  const top = ((sMin - lo) / 60) * WG_H + 1;
  const h = Math.max(22, ((eMin - sMin) / 60) * WG_H - 3);
  active.dropEl.style.top = top + "px";
  active.dropEl.style.height = h + "px";
  active.dropEl.classList.toggle("sh", h < 42);
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
  const curHi = +active.colEl.dataset.hi;
  const relY = clientY - r.top;
  const rawE = lo + (relY / WG_H) * 60;
  const minEnd = Math.min(DAY_MAX_M, active.origS + MIN_DUR);
  const eMin = Math.max(minEnd, Math.min(DAY_MAX_M, snapMin(rawE)));
  const neededHi = Math.min(GRID_MAX_HI, Math.max(active.origHi, Math.ceil(eMin / 60) * 60));
  if (neededHi !== curHi) {
    setGridHi(active.colEl.closest(".wg"), lo, neededHi);
  }
  active.newE = toTime(eMin);
  const h = Math.max(22, ((eMin - active.origS) / 60) * WG_H - 3);
  active.srcEl.style.height = h + "px";
  active.srcEl.classList.toggle("sh", h < 42);
  const bEl = active.srcEl.querySelector(".wb-top b");
  if (bEl) bEl.textContent = fmtT(active.newS) + "–" + fmtT(active.newE);
  const sc = $("scroller");
  if (sc && clientY > innerHeight - 56 && r.bottom > innerHeight - 70 && eMin < DAY_MAX_M) {
    sc.scrollTop += 20;
  }
}

/* ----- Mobile: pełny przesuwany kafelek, który płynnie kurczy się do pigułki nad kalendarzem ----- */
function startMobileDrag(clientX, clientY) {
  if (!active || active.started) return;
  active.started = true;
  if (active.lpTimer) {
    clearTimeout(active.lpTimer);
    active.lpTimer = 0;
  }
  if (active.armTimer) {
    clearTimeout(active.armTimer);
    active.armTimer = 0;
  }
  if (active.srcEl) active.srcEl.classList.remove("arming");
  try { if (navigator.vibrate) navigator.vibrate(15); } catch (e) {}

  document.body.classList.add("dragging", "mob-dragging");
  active.srcEl.classList.add("drag-src");
  markCalReady(true);

  const rect = active.srcEl.getBoundingClientRect();
  active.cardW = rect.width;
  active.cardLeft = rect.left;
  active.cardOffY = Math.min(rect.height - 12, Math.max(12, clientY - rect.top));

  /* Klonujemy cały kafelek zajęć, żeby przesuwał się naturalnie jak na desktopie */
  const ghost = document.createElement("div");
  ghost.className = "c " + active.typeCls + " drag-card-ghost";
  if (active.bg) ghost.style.setProperty("--drag-bg", active.bg);
  if (active.fg) ghost.style.setProperty("--drag-fg", active.fg);
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

  /* Desktop: podgląd potencjalnego miejsca dodania zajęć pod kursorem w trybie edycji */
  list.addEventListener("pointermove", (e) => {
    if (!isDesk() || !ui.editMode || ui.shOpen || ui.mcalOpen || active || e.pointerType === "touch") {
      hideAddPreview();
      return;
    }
    if (e.target.closest(".wb[data-cid]")) {
      hideAddPreview();
      return;
    }
    const col = e.target.closest(".wg-c[data-date]");
    if (!col) {
      hideAddPreview();
      return;
    }
    updateAddPreview(col, e.clientY);
  });

  list.addEventListener("pointerleave", hideAddPreview);
  window.addEventListener("scroll", hideAddPreview, true);

  /* Desktop: kliknięcie w puste miejsce na siatce tygodnia otwiera formularz z ustawionym dniem i godzinami */
  list.addEventListener("click", (e) => {
    if (!isDesk() || !ui.editMode || ui.shOpen || ui.mcalOpen || isDragging() || shouldSuppressClick()) return;
    if (e.target.closest(".wb[data-cid]")) return;
    const col = e.target.closest(".wg-c[data-date]");
    if (!col) return;
    const slot = calcAddSlot(col, e.clientY);
    const dObj = fromDK(slot.date);
    hideAddPreview();
    app.openForm({
      mode: "new",
      date: slot.date,
      wd: dObj ? wd(dObj) : wd(ui.sel),
      s: slot.s,
      e: slot.e,
    });
  });

  /* Mobile: blokuj systemowe menu kontekstowe przy long-press na kafelku w trybie edycji */
  list.addEventListener("contextmenu", (e) => {
    if (!isDesk() && ui.editMode && e.target.closest(".c[data-cid]")) e.preventDefault();
  });

  list.addEventListener("pointerdown", (e) => {
    hideAddPreview();
    if (!e.isPrimary) {
      if (active && active.platform === "mob" && !active.started) cleanup();
      return;
    }
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
        typeCls: wb.classList.contains("w") ? "w" : wb.classList.contains("l") ? "l" : wb.classList.contains("c2") ? "c2" : wb.classList.contains("p") ? "p" : "x",
        bg: wb.dataset.bg || "",
        fg: wb.dataset.fg || "",
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
        origHi: colEl ? +colEl.dataset.hi : MAX_M,
        started: false,
        ghost: null,
        dropEl: null,
        hintEl: null,
        hoverBtn: null,
        hoverTimer: 0,
      };
      return;
    }

    /* Mobile: long-press (~260 ms) bezpośrednio na kafelku zajęć .c */
    const card = e.target.closest(".c[data-cid]");
    if (!card || card.classList.contains("offc")) return;
    const base = cache.plan.classes.find((c) => c.id === card.dataset.cid);
    if (!base) return;

    active = {
      platform: "mob",
      mode: "move",
      isTouch: e.pointerType === "touch",
      pointerId: e.pointerId,
      cid: card.dataset.cid,
      name: base.name,
      typeCls: card.classList.contains("w") ? "w" : card.classList.contains("l") ? "l" : card.classList.contains("c2") ? "c2" : card.classList.contains("p") ? "p" : "x",
      bg: card.dataset.bg || "",
      fg: card.dataset.fg || "",
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
      started: false,
      armTimer: 0,
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
    active.armTimer = setTimeout(() => {
      if (active && !active.started && active.srcEl) active.srcEl.classList.add("arming");
    }, ARM_DELAY_MS);
    active.lpTimer = setTimeout(() => {
      if (active && !active.started) startMobileDrag(sx, sy);
    }, CARD_LP_MS);
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
          hideAddPreview();
          if (active.mode === "move") {
            document.body.classList.add("dragging");
            active.srcEl.classList.add("drag-src");
            const g = document.createElement("div");
            g.className = "drag-ghost " + active.typeCls;
            if (active.bg) g.style.background = active.bg;
            if (active.fg) g.style.color = active.fg;
            g.style.width = Math.max(130, active.width) + "px";
            g.style.height = Math.max(44, Math.min(active.height, 96)) + "px";
            g.innerHTML = '<b class="dg-time"></b><span class="dg-name">' + esc(active.name) + "</span>";
            document.body.appendChild(g);
            active.ghost = g;
            active.dropEl = createDropEl();

            const hint = document.createElement("div");
            hint.className = "drag-hint";
            hint.textContent = "Upuść na wybraną godzinę · ← / → lub najedź na ‹ › aby zmienić tydzień · Esc anuluje";
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

      /* Mobile: przed upływem czasu long-press ruch >10px anuluje (pozwala przewijać i przesuwać dni) */
      if (!active.started) {
        if (Math.hypot(dx, dy) > 10) cleanup();
        return;
      }
      if (active.isTouch) return;
      e.preventDefault();
      updateMobileMove(e.clientX, e.clientY);
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

  document.addEventListener(
    "touchmove",
    (e) => {
      if (!active || active.platform !== "mob" || !active.isTouch) return;
      if (e.touches.length !== 1) {
        finish(true);
        return;
      }
      const t = e.touches[0];
      if (!active.started) {
        if (Math.hypot(t.clientX - active.startX, t.clientY - active.startY) > 10) cleanup();
        return;
      }
      if (e.cancelable) e.preventDefault();
      updateMobileMove(t.clientX, t.clientY);
    },
    { passive: false }
  );

  document.addEventListener("touchend", () => {
    if (active && active.platform === "mob" && active.isTouch) finish(false);
  });

  document.addEventListener("touchcancel", () => {
    if (active && active.platform === "mob" && active.isTouch) finish(true);
  });

  document.addEventListener("pointerup", (e) => {
    if (!active || e.pointerId !== active.pointerId) return;
    finish(false);
  });

  document.addEventListener("pointercancel", (e) => {
    if (!active || e.pointerId !== active.pointerId) return;
    if (active.platform === "mob" && active.isTouch && active.started) return;
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
