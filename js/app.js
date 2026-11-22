/* ===== Główny punkt wejścia aplikacji eStudia ===== */

import { APP_VERSION, TABS, TAB_KEY, TV_KEY, HD_KEY, NOTIF_DEF, DEFAULT_PLAN } from "./config.js";
import { day0, same, dk, fromDK, clone, uid, serialize, absenceLimit, isExamTask } from "./core.js";
import { cfg, cache, conflict, hooks, isDevMode, enterDevMode, loadDevPlan, exitDevMode, commit, syncAll, resolveConflict, clearTokenState } from "./sync.js";
import { renderAlerts, askNotif, showNotif, enablePush, ensurePush, renderPushState } from "./push.js";
import { $, isDesk, mqD, dl, lsSet, setMsg, ui, app } from "./state.js";
import { openSheet, closeSheet, toast, ask, resolveAsk, change, undoLast, playGo, popCb } from "./ui/sheet.js";
import { renderSubjects, openSubject, ensureSubject, flushSave } from "./ui/subjects.js";
import { renderTasks, initOlForm, initTaskFilters, toggleOl, openTask, openNewTask, openExams, subjValueForName, tkBack, toggleTask, openAlertTask } from "./ui/tasks.js";
import {
  renderPlan,
  initPlanTooltips,
  updateProgress,
  tickClock,
  posMcal,
  openDetail,
  rerenderDetail,
  openForm,
  openOverride,
  openChooser,
  openDayMove,
  resetDayOverride,
  toggleCal,
  shiftDay,
  shiftWeek,
  goToday,
} from "./ui/plan.js";
import {
  renderSync,
  openSettings,
  openConflict,
  dfRender,
  download,
  archiveDoneTasks,
  openArchivedTasks,
  openNewSemester,
  switchSemester,
  deleteSemester,
} from "./ui/settings.js";
import { initDrag, isDragging, shouldSuppressClick } from "./ui/drag.js";

function renderTabs() {
  for (const k in TABS) {
    $("v-" + k).hidden = ui.tab !== k;
    const b = $("nv-" + k);
    if (ui.tab === k) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
  $("bnav").style.setProperty("--i", Object.keys(TABS).indexOf(ui.tab));
  if (!$("bnav").classList.contains("ready")) {
    requestAnimationFrame(() => requestAnimationFrame(() => $("bnav").classList.add("ready")));
  }
  $("ttl").textContent = TABS[ui.tab];
  $("ed").hidden = ui.tab !== "plan";
  if (ui.tab !== "plan") $("fab").hidden = true;
  document.body.classList.toggle("edit", ui.editMode && ui.tab === "plan");
  if (ui.tab === "tasks") renderTasks();
  if (ui.tab === "subj") renderSubjects();
}

function render() {
  ui.now = new Date();
  renderPlan();
  renderTabs();
  renderSync();
  renderAlerts();
  updateProgress();
}

function setTab(k) {
  if (!TABS[k] || k === ui.tab) return;
  ui.tab = k;
  ui.mcalOpen = false;
  if (k !== "plan") ui.editMode = false;
  lsSet(TAB_KEY, k);
  render();
  $("scroller").scrollTo(0, 0);
  playGo();
}

/* Podpięcie szyny między modułami */
Object.assign(app, {
  render,
  flushSave,
  openDetail,
  openTask,
  openSubject,
  openForm,
  openOverride,
  openChooser,
  openSettings,
  openConflict,
});

/* ----- Akcje wewnątrz arkuszy (data-sh) ----- */
function shAction(a) {
  const { cid, date } = ui.ctx;
  const ci = a.indexOf(":");
  if (ci > 0) {
    const k = a.slice(0, ci);
    const id = a.slice(ci + 1);
    if (k === "stab") openSubject(ui.ctx.sname, id);
    else if (k === "mac") {
      const nm = ui.ctx.sname;
      const tb = ui.ctx.stab;
      flushSave();
      change((p) => {
        ensureSubject(p, nm).mac = id;
      });
      openSubject(nm, tb);
    } else if (k === "stg") {
      toggleTask(id);
      const st = $("sheet").scrollTop;
      openSubject(ui.ctx.sname, "tasks", '[data-sh="stg:' + id + '"]');
      $("sheet").scrollTop = st;
      popCb(id);
    } else if (k === "sto") openTask(id, { back: { view: "subj", sname: ui.ctx.sname } });
    else if (k === "oe") openTask(id, { back: { view: "detail", cid, date } });
    else if (k === "tgo") {
      const [tcid, tdate] = id.split("|");
      const d = fromDK(tdate);
      if (d) {
        ui.sel = d;
        ui.mo = new Date(d.getFullYear(), d.getMonth(), 1);
        ui.mcalOpen = false;
        ui.tab = "plan";
        ui.editMode = false;
        lsSet(TAB_KEY, "plan");
        openDetail(tcid, tdate);
        render();
      }
    }
    else if (k === "tg") {
      const cur = cache.plan.tasks.find((x) => x.id === id);
      if (!cur || isExamTask(cur)) return;
      change((p) => {
        const t = p.tasks.find((x) => x.id === id);
        if (t && !isExamTask(t)) t.done = !t.done;
      });
      rerenderDetail('[data-sh="tg:' + id + '"]');
      popCb(id);
    } else if (k === "td") {
      const t = cache.plan.tasks.find((x) => x.id === id);
      if (!t) return;
      change((p) => {
        p.tasks = p.tasks.filter((x) => x.id !== id);
      }, "Usunięto zadanie");
      rerenderDetail('input[name="text"]');
    } else if (k === "abs") {
      const cls = cache.plan.classes.find((x) => x.id === cid);
      if (!cls) return;
      if (id === "toggle") {
        const wasAbs = (cache.plan.absences || []).some((x) => x.cid === cid && x.date === date);
        change((p) => {
          const list = Array.isArray(p.absences) ? p.absences : [];
          p.absences = wasAbs ? list.filter((x) => !(x.cid === cid && x.date === date)) : list.concat([{ cid, date }]);
        }, wasAbs ? "Usunięto nieobecność" : "Zaznaczono nieobecność");
        rerenderDetail('[data-sh="abs:toggle"]');
      } else if (id === "inc" || id === "dec") {
        const cur = absenceLimit(cache.plan, cls);
        const curNum = cur === null ? 0 : cur;
        const next = id === "inc" ? Math.min(30, curNum + 1) : Math.max(0, curNum - 1);
        change((p) => {
          if (!p.absLimits) p.absLimits = {};
          p.absLimits[cid] = next;
        });
        rerenderDetail('[data-sh="abs:' + id + '"]');
      }
    } else if (k === "archrest") {
      const t = (cache.plan.archivedTasks || []).find((x) => x.id === id);
      if (!t) return;
      change((p) => {
        p.archivedTasks = (p.archivedTasks || []).filter((x) => x.id !== id);
        const copy = clone(t);
        delete copy.label;
        copy.done = false;
        p.tasks.push(copy);
      }, "Przywrócono zadanie z archiwum");
      openArchivedTasks();
    } else if (k === "archdel") {
      change((p) => {
        p.archivedTasks = (p.archivedTasks || []).filter((x) => x.id !== id);
      }, "Usunięto zadanie z archiwum");
      openArchivedTasks();
    } else if (k === "exedit") {
      openTask(id, { back: { view: "exams" } });
    } else if (k === "semsw") {
      switchSemester(id);
    } else if (k === "semdel") {
      deleteSemester(id);
    }
    return;
  }

  switch (a) {
    case "close":
      closeSheet();
      break;
    case "backset":
      openSettings();
      break;
    case "archtasks":
      archiveDoneTasks();
      break;
    case "viewarch":
      openArchivedTasks();
      break;
    case "newsem":
      openNewSemester();
      break;
    case "sjadd":
      openNewTask({ subj: subjValueForName(ui.ctx.sname), back: { view: "subj", sname: ui.ctx.sname } });
      break;
    case "exadd":
      openNewTask({ cat: "exam", back: { view: "exams" } });
      break;
    case "sesadd":
      openNewTask({ cat: "session", back: { view: "exams" } });
      break;
    case "subj": {
      const c = cache.plan.classes.find((x) => x.id === cid);
      if (c) openSubject(c.name, c.type);
      break;
    }
    case "notif":
      askNotif();
      break;
    case "pushon":
      setMsg("pushStat", "Włączam…", "");
      enablePush().then((r) => {
        renderPushState().then(() => {
          if (!r.ok) setMsg("pushStat", r.msg, "bad");
        });
      });
      break;
    case "ntest":
      showNotif("eStudia", "To jest powiadomienie testowe.", "test").then((ok) =>
        setMsg("ntStat", ok ? "Wysłano powiadomienie testowe." : "Nie udało się wysłać powiadomienia.", ok ? "ok" : "bad")
      );
      break;
    case "tkback":
      tkBack();
      break;
    case "dfreset":
      if (change((p) => { p.notif = clone(NOTIF_DEF); })) {
        dfRender();
        setMsg("dfMsg", "Przywrócono wartości startowe.", "ok");
      }
      break;
    case "oldel": {
      const t = cache.plan.tasks.find((x) => x.id === ui.ctx.tid);
      if (!t) break;
      const back = ui.ctx.back;
      change((p) => {
        p.tasks = p.tasks.filter((x) => x.id !== t.id);
      }, "Usunięto zadanie");
      ui.ctx = { back };
      tkBack();
      break;
    }
    case "yes":
    case "no":
      resolveAsk(a === "yes");
      break;
    case "edit":
      openForm({ mode: "edit", cid });
      break;
    case "dup":
      openForm({ mode: "dup", cid });
      break;
    case "override":
      openOverride(cid, date);
      break;
    case "off": {
      const targetDate = ui.ctx.origDate || date;
      closeSheet();
      change((p) => {
        p.exceptions = p.exceptions.filter((x) => !(x.cid === cid && x.date === targetDate));
        p.exceptions.push({ id: uid(), cid, date: targetDate, off: true });
      }, "Odwołano zajęcia w dniu " + dl(fromDK(date)));
      break;
    }
    case "resetex": {
      const targetDate = ui.ctx.origDate || date;
      closeSheet();
      change((p) => {
        p.exceptions = p.exceptions.filter((x) => !(x.cid === cid && x.date === targetDate));
      }, "Przywrócono plan na ten dzień");
      break;
    }
    case "del": {
      const c = cache.plan.classes.find((x) => x.id === cid);
      if (!c) break;
      closeSheet();
      change((p) => {
        p.classes = p.classes.filter((x) => x.id !== cid);
      }, "Usunięto „" + c.name + "”");
      break;
    }
    case "syncnow":
      setMsg("cfgMsg", "Synchronizuję…", "");
      syncAll().then(() => setMsg("cfgMsg", ""));
      break;
    case "toklear":
      clearTokenState();
      closeSheet();
      toast("Usunięto token — tryb lokalny");
      renderSync();
      break;
    case "export":
      download("plan-zajec-" + dk(new Date()) + ".json", serialize(cache.plan));
      setMsg("bkMsg", "Plik z planem został pobrany.", "ok");
      break;
    case "import":
      $("impf").click();
      break;
    case "devon":
      enterDevMode();
      openSettings();
      toast("Włączono tryb deweloperski (odizolowany playground)");
      break;
    case "devload":
      $("devImpf").click();
      break;
    case "devexport":
      download("plan-testowy-" + dk(new Date()) + ".json", serialize(cache.plan));
      setMsg("devMsg", "Plik z planem testowym został pobrany.", "ok");
      break;
    case "devexit":
      if (exitDevMode()) {
        closeSheet();
        renderSync();
        render();
        toast("Przywrócono normalny plan");
        trySync();
      }
      break;
    case "reset":
      ask(
        "Przywrócić plan domyślny? Twoje zmiany zostaną zastąpione (będzie można je cofnąć tuż po zmianie).",
        "Przywróć"
      ).then((ok) => {
        if (!ok) return;
        const before = cache.plan;
        try {
          commit(clone(DEFAULT_PLAN));
        } catch (e) {
          toast("Nie udało się przywrócić planu.");
          return;
        }
        closeSheet();
        toast("Przywrócono plan domyślny", "Cofnij", () => {
          try { commit(before); } catch (e) {}
        });
      });
      break;
    case "cremote":
      resolveConflict("remote");
      ui.conflictShown = false;
      closeSheet();
      toast("Wczytano wersję z GitHuba");
      break;
    case "clocal": {
      const cnt = (q) => q.subjects.length + " przedmiotów, " + q.tasks.length + " zadań, " + q.classes.length + " zajęć";
      if (!conflict) break;
      ask(
        "Nadpisać GitHuba wersją z tego urządzenia? Na GitHubie jest: " +
          cnt(conflict.plan) +
          ". Na tym urządzeniu: " +
          cnt(cache.plan) +
          ". Wszystko, czego nie ma na tym urządzeniu, zostanie usunięte z GitHuba.",
        "Nadpisz GitHuba"
      ).then((ok) => {
        if (!ok) {
          openConflict();
          return;
        }
        resolveConflict("local");
        ui.conflictShown = false;
        closeSheet();
        toast("Wysyłam Twoją wersję na GitHuba");
      });
      break;
    }
  }
}

/* ----- Zdarzenia globalne ----- */
$("shBody").addEventListener("click", (e) => {
  const b = e.target.closest("[data-sh]");
  if (b) shAction(b.dataset.sh);
});
$("shbg").addEventListener("click", (e) => {
  if (e.target === $("shbg")) closeSheet();
});

function openShortcuts() {
  const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || "");
  const undoKey = isMac ? "⌘Z" : "Ctrl+Z";
  const row = (keys, desc) =>
    '<div class="kbd-row"><span class="kbd-keys">' +
    keys.map((k) => "<kbd>" + k + "</kbd>").join("") +
    '</span><span class="kbd-desc">' +
    desc +
    "</span></div>";
  ui.ctx = { view: "shortcuts" };
  openSheet(
    "Skróty klawiszowe",
    '<p class="shsub">Dostępne na komputerze i iPadzie z klawiaturą, gdy kursor nie znajduje się w polu tekstowym.</p>' +
      '<h3 class="sec">Globalne</h3><div class="kbd-list">' +
      row(["1", "2", "3"], "Przełącz zakładkę (Plan, Zadania, Przedmioty)") +
      row([","], "Otwórz Ustawienia") +
      row(["R"], "Synchronizuj teraz z GitHubem") +
      row([undoKey], "Cofnij ostatnią zmianę") +
      row(["?"], "Pokaż lub zamknij tę ściągawkę") +
      row(["Esc"], "Zamknij panel / kalendarz / anuluj przeciąganie") +
      '</div><h3 class="sec">Plan zajęć</h3><div class="kbd-list">' +
      row(["←", "→"], "Poprzedni / następny tydzień (także przy przeciąganiu)") +
      row(["T"], "Przejdź do dzisiaj") +
      row(["E"], "Włącz / wyłącz tryb edycji") +
      row(["N"], "Dodaj nowe zajęcia") +
      row(["C"], "Otwórz / zamknij kalendarz miesiąca") +
      '</div><h3 class="sec">Zadania</h3><div class="kbd-list">' +
      row(["N"], "Dodaj nowe zadanie") +
      row(["/"], "Szukaj zadań") +
      row(["K"], "Otwórz Sesja / Kolokwia") +
      row(["H"], "Ukryj / pokaż ukończone zadania") +
      '</div><div class="acts" style="margin-top:16px"><button type="button" class="btn" data-sh="close">Zamknij</button></div>'
  );
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && ui.shOpen) { closeSheet(); return; }
  if (e.key === "Escape" && ui.mcalOpen) { ui.mcalOpen = false; render(); return; }
  if (e.key === "Tab" && ui.shOpen) {
    const sh = $("sheet");
    const f = [...sh.querySelectorAll("button,input,select,textarea")].filter(
      (x) => !x.disabled && !x.hidden && x.type !== "hidden" && x.offsetParent !== null
    );
    if (!f.length) return;
    const a = f[0];
    const z = f[f.length - 1];
    const cur = document.activeElement;
    if (e.shiftKey && (cur === a || cur === sh)) { e.preventDefault(); z.focus(); }
    else if (!e.shiftKey && cur === z) { e.preventDefault(); a.focus(); }
    return;
  }
  if ((e.key === "Enter" || e.key === " ") && !ui.shOpen) {
    const c = e.target.closest && e.target.closest('.c[role="button"],.wb[role="button"]');
    if (c && e.target === c) {
      e.preventDefault();
      if (ui.editMode) openChooser(c.dataset.cid, c.dataset.date);
      else openDetail(c.dataset.cid, c.dataset.date);
      return;
    }
  }
  /* Skróty klawiszowe (komputer / iPad z klawiaturą) */
  if (!isDesk()) return;
  const t = e.target;
  const tg = t && t.tagName;
  const inInput = tg === "INPUT" || tg === "TEXTAREA" || tg === "SELECT" || (t && t.isContentEditable);
  if (inInput) return;

  /* Zamknięcie ściągawki ponownym wciśnięciem ? */
  if (ui.shOpen) {
    if (ui.ctx && ui.ctx.view === "shortcuts" && e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      closeSheet();
    }
    return;
  }

  /* Cmd+Z / Ctrl+Z: Cofnij ostatnią zmianę */
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "z") {
    e.preventDefault();
    undoLast();
    return;
  }

  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  const kl = k.toLowerCase();
  if (k === "1" || k === "2" || k === "3") {
    setTab(["plan", "tasks", "subj"][+k - 1]);
    return;
  }
  if (k === ",") {
    e.preventDefault();
    openSettings();
    return;
  }
  if (k === "?") {
    e.preventDefault();
    openShortcuts();
    return;
  }
  if (kl === "r") {
    e.preventDefault();
    if (isDevMode()) toast("Tryb deweloperski — synchronizacja wyłączona");
    else if (!cfg.token) toast("Tryb lokalny — dodaj token w Ustawieniach, aby synchronizować");
    else {
      toast("Synchronizuję…");
      trySync();
    }
    return;
  }
  if (ui.tab === "plan") {
    if (k === "ArrowLeft" || k === "ArrowRight") {
      e.preventDefault();
      shiftWeek(k === "ArrowLeft" ? -1 : 1);
    } else if (kl === "t") {
      goToday();
    } else if (kl === "e") {
      e.preventDefault();
      ui.editMode = !ui.editMode;
      render();
    } else if (kl === "n") {
      e.preventDefault();
      openForm({ mode: "new" });
    } else if (kl === "c") {
      e.preventDefault();
      ui.mcalOpen = !ui.mcalOpen;
      if (ui.mcalOpen) {
        ui.mcalAnchor = "wk";
        ui.mo = new Date(ui.sel.getFullYear(), ui.sel.getMonth(), 1);
      }
      render();
    }
  } else if (ui.tab === "tasks") {
    if (kl === "n") {
      e.preventDefault();
      if (!ui.olOpen) toggleOl(true);
    } else if (k === "/") {
      e.preventDefault();
      const s = $("tkSearch");
      if (s) {
        s.focus();
        s.select();
      }
    } else if (kl === "k") {
      e.preventDefault();
      openExams();
    } else if (kl === "h") {
      e.preventDefault();
      ui.hideDone = !ui.hideDone;
      lsSet(HD_KEY, ui.hideDone ? "1" : "0");
      render();
      playGo();
    }
  }
});

document.addEventListener("click", (e) => {
  if (ui.mcalOpen && !$("mini").contains(e.target) && !e.target.closest('[data-a^="mcal:"]')) {
    ui.mcalOpen = false;
    $("mini").hidden = true;
    render();
  }
  const cd = e.target.closest(".c[data-cid],.wb[data-cid]");
  if (cd && !ui.shOpen) {
    if (shouldSuppressClick()) return;
    if (ui.editMode) openChooser(cd.dataset.cid, cd.dataset.date);
    else openDetail(cd.dataset.cid, cd.dataset.date);
    return;
  }
  const b = e.target.closest("[data-a]");
  if (!b) return;
  const [k, v] = b.dataset.a.split(":");
  if (k === "mcal") {
    if (!isDesk()) return;
    const anc = v || "wk";
    if (ui.mcalOpen && ui.mcalAnchor === anc) ui.mcalOpen = false;
    else {
      ui.mcalOpen = true;
      ui.mcalAnchor = anc;
      ui.mo = new Date(ui.sel.getFullYear(), ui.sel.getMonth(), 1);
    }
    render();
    return;
  }
  if (k === "tab") { setTab(v); return; }
  if (k === "goTasks") {
    ui.tkQuery = "";
    ui.tkSubj = "";
    ui.tkCat = "";
    setTab("tasks");
    return;
  }
  if (k !== "cal") ui.lastFill = {};
  let toPlan = false;
  if (k === "s") {
    const p = v.split(",").map(Number);
    ui.sel = new Date(p[0], p[1], p[2]);
    if (ui.sel.getMonth() !== ui.mo.getMonth()) ui.mo = new Date(p[0], p[1], 1);
    ui.mcalOpen = false;
    if (ui.tab !== "plan") {
      ui.tab = "plan";
      ui.editMode = false;
      lsSet(TAB_KEY, "plan");
      toPlan = true;
    }
  } else if (k === "m") ui.mo = new Date(ui.mo.getFullYear(), ui.mo.getMonth() + +v, 1);
  else if (k === "wk") { shiftWeek(+v); return; }
  else if (k === "cal") { toggleCal(); return; }
  else if (k === "dy") { shiftDay(+v); return; }
  else if (k === "today") {
    ui.sel = day0(new Date());
    ui.mo = new Date(ui.sel.getFullYear(), ui.sel.getMonth(), 1);
    ui.mcalOpen = false;
  } else if (k === "edit") ui.editMode = !ui.editMode;
  else if (k === "ol") { toggleOl(!ui.olOpen); return; }
  else if (k === "exams") { openExams(); return; }
  else if (k === "hd") {
    ui.hideDone = !ui.hideDone;
    lsSet(HD_KEY, ui.hideDone ? "1" : "0");
  } else if (k === "tg") { toggleTask(v); return; }
  else if (k === "to") { openTask(v); return; }
  else if (k === "sj") { openSubject(decodeURIComponent(v)); return; }
  else if (k === "tk") { openAlertTask(v); return; }
  else if (k === "nt") { askNotif(); return; }
  else if (k === "set") { openSettings(); return; }
  else if (k === "add") { openForm({ mode: "new" }); return; }
  else if (k === "daymove") { openDayMove(v); return; }
  else if (k === "dayreset") { resetDayOverride(v); return; }
  else if (k === "jump") {
    const d = fromDK(v);
    if (!d) return;
    ui.sel = d;
    ui.mo = new Date(d.getFullYear(), d.getMonth(), 1);
    ui.mcalOpen = false;
  }
  else if (k === "devload") { $("devImpf").click(); return; }
  else if (k === "devexit") {
    if (exitDevMode()) {
      closeSheet();
      renderSync();
      render();
      toast("Przywrócono normalny plan");
      trySync();
    }
    return;
  }
  else if (k === "chip") {
    if (conflict) openConflict();
    else openSettings();
    return;
  }
  render();
  if (toPlan) $("scroller").scrollTo(0, 0);
  if (k === "s" || k === "today" || k === "jump" || k === "tv" || k === "hd") playGo();
});

/* Gest przesuwania tygodni na pasku kalendarza oraz dni na liście dnia (telefon) */
(function initSwipes() {
  const c = $("cal");
  let x0 = 0;
  let y0 = 0;
  let on = false;
  c.addEventListener("touchstart", (e) => {
    if (ui.calOpen || isDesk() || e.touches.length !== 1) { on = false; return; }
    x0 = e.touches[0].clientX;
    y0 = e.touches[0].clientY;
    on = true;
  }, { passive: true });
  c.addEventListener("touchend", (e) => {
    if (!on || ui.calOpen) return;
    on = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - x0;
    const dy = t.clientY - y0;
    if (Math.abs(dx) > 45 && Math.abs(dx) > 1.5 * Math.abs(dy)) shiftWeek(dx < 0 ? 1 : -1);
  }, { passive: true });
  c.addEventListener("touchcancel", () => { on = false; }, { passive: true });

  const lst = $("list");
  let lx0 = 0;
  let ly0 = 0;
  let lon = false;
  lst.addEventListener("touchstart", (e) => {
    if (isDesk() || ui.shOpen || isDragging() || e.touches.length !== 1) { lon = false; return; }
    lx0 = e.touches[0].clientX;
    ly0 = e.touches[0].clientY;
    lon = true;
  }, { passive: true });
  lst.addEventListener("touchend", (e) => {
    if (!lon) return;
    lon = false;
    if (isDesk() || ui.shOpen || isDragging() || shouldSuppressClick()) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - lx0;
    const dy = t.clientY - ly0;
    if (Math.abs(dx) > 55 && Math.abs(dx) > 1.8 * Math.abs(dy)) shiftDay(dx < 0 ? 1 : -1);
  }, { passive: true });
  lst.addEventListener("touchcancel", () => { lon = false; }, { passive: true });
})();

/* Hooki synchronizacji */
hooks.adopted = (prev) => {
  toast("Wczytano plan z GitHuba. To, co było tylko na tym urządzeniu, można przywrócić.", "Przywróć", () => {
    try { commit(prev); } catch (e) {}
  });
};
hooks.sync = renderSync;
hooks.changed = () => {
  ui.lastFill = {};
  render();
};
hooks.conflict = () => {
  if (!ui.shOpen && !ui.conflictShown) openConflict();
};

/* Obrót iPada / zmiana rozmiaru okna */
{
  const onLayout = () => {
    ui.lastFill = {};
    render();
    if (ui.shOpen && ui.ctx && ui.ctx.view === "settings") openSettings();
  };
  if (mqD.addEventListener) mqD.addEventListener("change", onLayout);
  else if (mqD.addListener) mqD.addListener(onLayout);
}

/* Samoaktualizacja (dla PWA na iOS) */
let updChecking = false;
async function checkUpdate() {
  if (updChecking || !/^https?:$/.test(location.protocol) || !navigator.onLine) return;
  updChecking = true;
  try {
    const r = await fetch(location.pathname.replace(/[^/]*$/, "") + "index.html?v=" + Date.now(), { cache: "no-store" });
    if (!r.ok) return;
    const txt = await r.text();
    const m = /<meta\s+name="app-version"\s+content="([^"]+)"/.exec(txt) || /const APP_VERSION="([^"]+)"/.exec(txt);
    if (!m || m[1] === APP_VERSION) return;
    if (ui.shOpen || ui.sjSave || cache.dirty) {
      toast("Dostępna nowa wersja aplikacji (" + m[1] + ").", "Odśwież", () => location.reload());
      return;
    }
    location.reload();
  } catch (e) {
  } finally {
    updChecking = false;
  }
}

/* Deep-link z powiadomienia push (?task=<id>) */
function handleDeepLink() {
  try {
    const params = new URLSearchParams(location.search);
    const tid = params.get("task");
    if (!tid) return;
    if (cache.plan.tasks.some((t) => t.id === tid)) {
      openAlertTask(tid);
      history.replaceState(null, "", location.pathname);
    }
  } catch (e) {}
}

/* Wczytywanie pliku JSON do odizolowanego trybu deweloperskiego (playground) */
const devImpf = $("devImpf");
if (devImpf) {
  devImpf.onchange = () => {
    const f = devImpf.files && devImpf.files[0];
    devImpf.value = "";
    if (!f) return;
    if (f.size > 2e6) {
      setMsg("devMsg", "Plik jest za duży.", "bad");
      toast("Plik jest za duży.");
      return;
    }
    const r = new FileReader();
    r.onload = () => {
      let raw;
      try {
        raw = JSON.parse(String(r.result));
      } catch (e) {
        setMsg("devMsg", "Plik nie jest poprawnym JSON-em.", "bad");
        toast("Plik nie jest poprawnym JSON-em.");
        return;
      }
      const res = loadDevPlan(raw);
      if (!res.ok) {
        setMsg("devMsg", res.error, "bad");
        toast("Błędny plik planu: " + res.error);
        return;
      }
      closeSheet();
      renderSync();
      render();
      toast("Wczytano plan testowy: " + f.name);
    };
    r.readAsText(f);
  };
}

/* Inicjalizacja */
initOlForm();
initTaskFilters();
initDrag();
initPlanTooltips();
renderSync();
render();
handleDeepLink();

if (window.ResizeObserver) new ResizeObserver(updateProgress).observe($("list"));
addEventListener("resize", () => {
  updateProgress();
  if (ui.mcalOpen) posMcal();
});
$("scroller").addEventListener("scroll", () => {
  if (ui.mcalOpen) posMcal();
}, { passive: true });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(updateProgress);

let seen = day0(new Date());
let lastSync = 0;
function fresh() {
  const t = day0(new Date());
  if (!same(t, seen)) {
    seen = t;
    ui.sel = t;
    ui.mo = new Date(t.getFullYear(), t.getMonth(), 1);
  }
  render();
}
function tick() {
  const t = day0(new Date());
  if (!same(t, seen)) {
    fresh();
    return;
  }
  tickClock();
  renderAlerts();
  renderAhead();
  if (ui.tab === "subj") renderSubjects();
}
function trySync() {
  lastSync = Date.now();
  syncAll();
}

setInterval(tick, 60000);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  fresh();
  if (Date.now() - lastSync > 30000) trySync();
  checkUpdate();
});
addEventListener("pageshow", fresh);
addEventListener("online", () => {
  trySync();
  syncLocalNotifsToPushState();
});

if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
  addEventListener("load", () => {
    navigator.serviceWorker
      .register("sw.js", { updateViaCache: "none" })
      .then((r) => { r.update().catch(() => {}); })
      .catch(() => {});
  });
}

checkUpdate();
trySync();
ensurePush();
