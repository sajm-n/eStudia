/* ===== Ustawienia, domyślne powiadomienia, kopia zapasowa, status synchronizacji i konflikty ===== */

import { APP_VERSION, WD_IN, DOWS } from "../config.js";
import { pad, day0, wd, dk, fromDK, normT, fmtT, mondayOf, validatePlan, mergeSchedule, typeLabel, ruleStart, uid, clone, isTaskDone } from "../core.js";
import { cfg, cache, sync, conflict, isDevMode, saveCfg, resetSyncTarget, commit, syncAll, testToken } from "../sync.js";
import { ensurePush, renderNotifState, renderPushDiag } from "../push.js";
import { $, esc, dl, hm, selOpts, setMsg, ui } from "../state.js";
import { openSheet, closeSheet, toast, ask, change } from "./sheet.js";
import { fmtDur, taskLabelOf, catChip, taskMeta } from "./tasks.js";

export function syncText() {
  if (isDevMode()) return ["Tryb dev (playground)", "warn"];
  const s = sync.state;
  const d = cache.dirty;
  const t = !!cfg.token;
  if (!t) return ["Tryb lokalny", ""];
  if (s === "pulling" || s === "pushing") return ["Synchronizuję…", "busy"];
  if (conflict) return ["Konflikt zmian — stuknij", "bad"];
  if (s === "error") return ["Błąd synchronizacji — stuknij", "bad"];
  if (s === "offline") return [d ? "Offline — zmiany czekają" : "Offline", "warn"];
  if (d) return ["Czeka na wysłanie", "warn"];
  const a = sync.at ? new Date(sync.at) : null;
  return ["Zsynchronizowano" + (a ? " " + pad(a.getHours()) + ":" + pad(a.getMinutes()) : ""), "ok"];
}

export function renderSync() {
  const r = syncText();
  const cl = "chip" + (r[1] ? " " + r[1] : "");
  const c = $("chip");
  if (c) {
    c.className = cl;
    $("chipT").textContent = r[0];
  }
  const cd = $("chipD");
  if (cd) {
    cd.className = cl;
    $("chipDT").textContent = r[0];
  }
  const st = $("cfgStat");
  if (st) st.textContent = r[0] + (sync.msg ? " — " + sync.msg : "");
  const db = $("devBar");
  if (db) db.hidden = !isDevMode();
  document.body.classList.toggle("devmode", isDevMode());
}

export function download(name, text) {
  const b = new Blob([text], { type: "application/json" });
  const u = URL.createObjectURL(b);
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}

/* ----- Domyślne powiadomienia (Ustawienia) ----- */
const DF_DAYS = [1, 0, 2, 3, 7];
const DF_REL = [5, 10, 15, 30, 60, 120, 300, 720, 1440, 2880, 4320, 10080];
const dfKey = (r) => (r.m === "day" ? "day:" + r.days : "rel:" + r.min);
const dfDays = (n) =>
  n === 0 ? "W dniu terminu" : n === 1 ? "Dzień przed terminem" : n === 7 ? "Tydzień przed terminem" : n + " dni przed terminem";

function dfSelect(r) {
  const day = DF_DAYS.map((n) => ["day:" + n, dfDays(n)]);
  const rel = DF_REL.map((m) => ["rel:" + m, fmtDur(m) + " przed terminem"]);
  const k = dfKey(r);
  if (!day.concat(rel).some((o) => o[0] === k)) {
    (r.m === "day" ? day : rel).push([k, r.m === "day" ? dfDays(r.days) : fmtDur(r.min) + " przed terminem"]);
  }
  return (
    '<optgroup label="O stałej godzinie">' +
    selOpts(day, k) +
    '</optgroup><optgroup label="Ile czasu przed terminem">' +
    selOpts(rel, k) +
    "</optgroup>"
  );
}

function dfRead(kind) {
  const E = $("dfF").elements;
  const v = E[kind].value.split(":");
  const n = +v[1];
  if (v[0] === "rel") return { m: "rel", min: n };
  const tm = normT(E[kind + "T"].value);
  return tm ? { m: "day", days: n, time: tm } : null;
}

function dfExample(r) {
  const x = day0(new Date());
  let end = new Date(x.getFullYear(), x.getMonth(), x.getDate() + 3, 10, 0);
  while (wd(end) !== 0) end = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1, 10, 0);
  let s = ruleStart(r, day0(end), end);
  if (s > end) s = end;
  return "Przykład: termin " + WD_IN[0] + " o 10:00 → powiadomienie " + WD_IN[wd(s)] + " o " + fmtT(hm(s)) + ".";
}

export function dfRender() {
  const box = $("dfBox");
  if (!box) return;
  const n = cache.plan.notif;
  const r = n.task || n.onsite || n.online;
  const m = n.morning || { on: false, time: "07:30" };
  box.innerHTML =
    '<div class="dfb"><label class="fl">Domyślne powiadomienie o zadaniach<select name="task">' +
    dfSelect(r) +
    '</select></label><label class="fl" data-tm="task"' +
    (r.m === "day" ? "" : " hidden") +
    '>Godzina powiadomienia<input type="time" name="taskT" value="' +
    esc(r.m === "day" ? r.time : "18:00") +
    '"></label><p class="hint" data-ex="task">' +
    esc(dfExample(r)) +
    '</p></div>' +
    '<div class="dfb"><label class="chkrow"><input type="checkbox" name="morningOn"' +
    (m.on ? " checked" : "") +
    '><span>Poranny skrót dnia (push)</span></label><label class="fl" data-tm="morning"' +
    (m.on ? "" : " hidden") +
    '>Godzina porannego skrótu<input type="time" name="morningT" value="' +
    esc(m.time || "07:30") +
    '"></label><p class="hint">Jedno powiadomienie rano z liczbą zajęć, startem, salą i dzisiejszymi zadaniami (tylko gdy coś masz).</p></div>';
  const save = () => {
    const E = $("dfF").elements;
    const rule = dfRead("task");
    box.querySelector('[data-tm="task"]').hidden = E.task.value.startsWith("rel:");
    if (!rule) {
      setMsg("dfMsg", "Podaj godzinę powiadomienia.", "bad");
      return;
    }
    box.querySelector('[data-ex="task"]').textContent = dfExample(rule);
    const mOn = !!E.morningOn.checked;
    box.querySelector('[data-tm="morning"]').hidden = !mOn;
    const mTime = normT(E.morningT.value) || "07:30";
    const curM = cache.plan.notif.morning || { on: false, time: "07:30" };
    if (
      JSON.stringify(cache.plan.notif.task) === JSON.stringify(rule) &&
      curM.on === mOn &&
      curM.time === mTime
    ) {
      if ($("dfMsg").classList.contains("bad")) setMsg("dfMsg", "");
      return;
    }
    const ok = change((p) => {
      p.notif.task = rule;
      p.notif.onsite = Object.assign({}, rule);
      p.notif.online = Object.assign({}, rule);
      p.notif.morning = { on: mOn, time: mTime };
    });
    setMsg("dfMsg", ok ? "Zapisano ✓" : "Nie udało się zapisać.", ok ? "ok" : "bad");
  };
  const E = $("dfF").elements;
  E.task.onchange = save;
  E.taskT.onchange = save;
  E.morningOn.onchange = save;
  E.morningT.onchange = save;
}

export function openSettings() {
  const c = cfg;
  const p = cache.plan;
  openSheet(
    "Ustawienia",
    '<p class="shsub" id="cfgStat" role="status"></p>' +
      '<h3 class="sec">Synchronizacja z GitHub</h3>' +
      '<p class="hint"><b>Tryb lokalny</b> (bez tokena): dane zostają tylko w pamięci tej przeglądarki, nic nie jest pobierane z serwera ani wysyłane. <b>Tryb serwerowy</b> (z tokenem): dane synchronizują się z plikiem w repozytorium na wszystkich urządzeniach. Token tworzysz na github.com (Settings → Developer settings → Fine-grained tokens) z uprawnieniem „Contents: Read and write” tylko dla tego repozytorium. Token zapisuje się wyłącznie w tej przeglądarce.</p>' +
      '<form id="cfgF" novalidate autocomplete="off">' +
      '<label class="fl">Repozytorium (właściciel/nazwa)<input name="repo" value="' +
      esc(c.owner + "/" + c.repo) +
      '" autocapitalize="none" autocorrect="off" spellcheck="false"></label>' +
      '<div class="two"><label class="fl">Plik<input name="path" value="' +
      esc(c.path) +
      '" autocapitalize="none" autocorrect="off" spellcheck="false"></label><label class="fl">Gałąź<input name="branch" value="' +
      esc(c.branch) +
      '" autocapitalize="none" autocorrect="off" spellcheck="false"></label></div>' +
      '<label class="fl">Token dostępu<input name="token" type="password" value="" placeholder="' +
      (c.token ? "Token zapisany — wpisz nowy, aby zmienić" : "github_pat_…") +
      '" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false"></label>' +
      '<p id="cfgMsg" class="msg" role="status"></p>' +
      '<div class="acts"><button type="submit" class="btn pri">Zapisz i sprawdź</button><button type="button" class="btn" data-sh="syncnow">Synchronizuj teraz</button>' +
      (c.token ? '<button type="button" class="btn dng" data-sh="toklear">Usuń token</button>' : "") +
      "</div></form>" +
      '<h3 class="sec">Rytm tygodni A/B</h3>' +
      '<form id="abF" novalidate><div class="two"><label class="fl">Dowolny dzień tygodnia<input type="date" name="d" value="' +
      esc(p.start) +
      '"></label><label class="fl">Ten tydzień to<select name="w">' +
      selOpts(
        [
          ["A", "Tydzień A"],
          ["B", "Tydzień B"],
        ],
        p.startWeek
      ) +
      '</select></label></div><p id="abMsg" class="msg" role="status"></p><div class="acts"><button type="submit" class="btn">Zapisz rytm</button></div></form>' +
      '<h3 class="sec">Powiadomienia o zadaniach</h3>' +
      '<p class="hint">Kiedy przyjdzie przypomnienie, ustawisz w formularzu zadania, a domyślny termin dla nowych zadań w sekcji „Domyślne powiadomienia” poniżej. Czerwony pasek na górze aplikacji pokazuje pilne zadania zawsze. Gdy aplikacja jest otwarta, powiadomienie pojawia się od razu. Gdy jest zamknięta, wysyła je GitHub; wymaga to trybu serwerowego i włączenia poniżej.</p>' +
      '<p id="ntStat" class="msg" role="status"></p><div class="acts" id="ntActs"></div>' +
      '<p id="pushStat" class="msg" role="status" style="margin-top:10px"></p><div class="acts" id="pushActs"></div>' +
      '<p id="pushDiag" class="hint" style="margin-top:8px" role="status"></p>' +
      '<h3 class="sec">Domyślne powiadomienia</h3>' +
      '<p class="hint">Nowe zadanie dostaje taki termin powiadomienia, dopóki w jego formularzu nie wybierzesz innego (przycisk „Domyślne”). Zmiana obejmuje też istniejące zadania bez własnego terminu.</p>' +
      '<form id="dfF" novalidate autocomplete="off"><div id="dfBox"></div><p id="dfMsg" class="msg" role="status"></p>' +
      '<div class="acts"><button type="button" class="btn" data-sh="dfreset">Przywróć wartości startowe</button></div></form>' +
      '<h3 class="sec">Semestr i archiwum</h3>' +
      '<form id="semF" novalidate autocomplete="off">' +
      '<label class="fl">Nazwa bieżącego semestru<input name="sem" maxlength="60" value="' +
      esc(p.semester || "") +
      '" placeholder="np. Semestr 1 (2026/27)"></label>' +
      '<p id="semMsg" class="msg" role="status"></p>' +
      '<div class="acts"><button type="submit" class="btn">Zapisz nazwę</button><button type="button" class="btn" data-sh="newsem">Zakończ semestr i zacznij nowy</button></div></form>' +
      (() => {
        const doneN = p.tasks.filter((t) => isTaskDone(t, ui.now, p)).length;
        const archN = Array.isArray(p.archivedTasks) ? p.archivedTasks.length : 0;
        const sems = Array.isArray(p.semesters) ? p.semesters : [];
        const semRows = sems.length
          ? '<p class="hint" style="margin-top:10px">Zapisane semestry (przełączenie zachowuje obecny semestr w archiwum):</p><div class="sem-list">' +
            sems
              .map(
                (s) =>
                  '<div class="sem-row"><div class="sem-info"><b>' +
                  esc(s.name) +
                  "</b><span>" +
                  s.plan.classes.length +
                  " zajęć · " +
                  s.plan.tasks.length +
                  ' zadań</span></div><div class="sem-acts"><button type="button" class="btn" data-sh="semsw:' +
                  esc(s.id) +
                  '">Przełącz</button><button type="button" class="btn dng" data-sh="semdel:' +
                  esc(s.id) +
                  '">Usuń</button></div></div>'
              )
              .join("") +
            "</div>"
          : "";
        return (
          '<div class="acts" style="margin-top:10px">' +
          (doneN
            ? '<button type="button" class="btn" data-sh="archtasks">Zarchiwizuj ukończone zadania (' + doneN + ")</button>"
            : "") +
          (archN
            ? '<button type="button" class="btn" data-sh="viewarch">Pokaż archiwum zadań (' + archN + ")</button>"
            : "") +
          "</div>" +
          semRows
        );
      })() +
      '<h3 class="sec">Kopia zapasowa i import</h3>' +
      '<p class="hint">Import pliku JSON pozwala zaktualizować wyłącznie plan zajęć (np. nowy plik z eStudiaTools po zmianie sal — bez utraty zadań, notatek i nieobecności) albo zastąpić całą bazę z kopii zapasowej.</p>' +
      '<div class="acts"><button type="button" class="btn" data-sh="export">Eksportuj plan</button><button type="button" class="btn" data-sh="import">Importuj plan</button><button type="button" class="btn dng" data-sh="reset">Przywróć plan domyślny</button></div>' +
      '<input type="file" id="impf" accept=".json,application/json" hidden>' +
      '<p id="bkMsg" class="msg" role="status" style="margin-top:8px"></p>' +
      '<h3 class="sec">Tryb deweloperski (playground)</h3>' +
      '<p class="hint">Odizolowane środowisko testowe. Wczytane pliki i wprowadzone zmiany zapisują się osobno i nigdy nie trafiają na GitHub. W każdej chwili wrócisz do swojego normalnego planu.</p>' +
      (isDevMode()
        ? '<p class="msg warn" role="status">Tryb deweloperski jest AKTYWNY — pracujesz na odizolowanej kopii testowej.</p>' +
          '<div class="acts"><button type="button" class="btn" data-sh="devload">Wczytaj inny plik testowy (.json)</button><button type="button" class="btn" data-sh="devexport">Eksportuj plan testowy</button><button type="button" class="btn pri" data-sh="devexit">Wyłącz i wróć do normalnego planu</button></div>'
        : '<div class="acts"><button type="button" class="btn" data-sh="devon">Włącz tryb deweloperski</button><button type="button" class="btn" data-sh="devload">Wczytaj plan testowy z pliku (.json)</button></div>') +
      '<p id="devMsg" class="msg" role="status" style="margin-top:8px"></p>' +
      '<p class="hint" style="margin-top:14px"><b>Wersja aplikacji: ' +
      APP_VERSION +
      "</b></p>" +
      '<p class="hint" id="diag"></p>' +
      '<div class="acts" style="margin-top:14px"><button type="button" class="btn" data-sh="close">Zamknij</button></div>'
  );
  renderSync();
  renderNotifState();
  renderPushDiag();
  dfRender();
  $("semF").onsubmit = (ev) => {
    ev.preventDefault();
    const val = $("semF").elements.sem.value.trim();
    const ok = change((pl) => {
      if (val) pl.semester = val;
      else delete pl.semester;
    });
    setMsg("semMsg", ok ? "Zapisano nazwę semestru ✓" : "Nie udało się zapisać.", ok ? "ok" : "bad");
  };
  try {
    const pr = document.createElement("div");
    pr.style.cssText = "position:fixed;left:0;top:0;visibility:hidden;padding-bottom:env(safe-area-inset-bottom,0px)";
    document.body.appendChild(pr);
    const ib = pr.offsetHeight;
    pr.remove();
    $("diag").textContent =
      "Ekran: okno " +
      innerWidth +
      "×" +
      innerHeight +
      ", ekran " +
      screen.width +
      "×" +
      screen.height +
      ", dolny margines " +
      ib +
      ", tryb " +
      (navigator.standalone || matchMedia("(display-mode: standalone)").matches ? "aplikacja" : "przeglądarka");
  } catch (e) {}

  $("cfgF").onsubmit = async (ev) => {
    ev.preventDefault();
    const E = $("cfgF").elements;
    const m = /^([\w.-]+)\/([\w.-]+)$/.exec(E.repo.value.trim());
    if (!m) {
      setMsg("cfgMsg", "Repozytorium podaj w postaci właściciel/nazwa.", "bad");
      return;
    }
    const path = E.path.value.trim().replace(/^\/+/, "");
    if (!path) {
      setMsg("cfgMsg", "Podaj nazwę pliku z planem.", "bad");
      return;
    }
    const branch = E.branch.value.trim() || "main";
    const token = E.token.value.trim() || cfg.token;
    const moved = cfg.owner !== m[1] || cfg.repo !== m[2] || cfg.path !== path || cfg.branch !== branch;
    saveCfg({ token, owner: m[1], repo: m[2], path, branch });
    if (moved) resetSyncTarget();
    setMsg("cfgMsg", "Sprawdzam…", "");
    if (token) {
      const r = await testToken(cfg);
      setMsg("cfgMsg", r.msg, r.ok ? "ok" : "bad");
      if (r.ok) {
        await syncAll();
        ensurePush();
      }
    } else {
      setMsg("cfgMsg", "Zapisano. Tryb lokalny: dane zostają tylko w tej przeglądarce.", "");
      await syncAll();
    }
    renderSync();
  };

  $("abF").onsubmit = (ev) => {
    ev.preventDefault();
    const E = $("abF").elements;
    const d = fromDK(E.d.value);
    if (!d) {
      setMsg("abMsg", "Wybierz poprawną datę.", "bad");
      return;
    }
    const ok = change((pl) => {
      pl.start = dk(mondayOf(d));
      pl.startWeek = E.w.value;
    });
    setMsg(
      "abMsg",
      ok ? "Zapisano. Tydzień zaczynający się " + dl(mondayOf(d)) + " to tydzień " + E.w.value + "." : "Nie udało się zapisać.",
      ok ? "ok" : "bad"
    );
  };

  $("impf").onchange = async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = "";
    if (!file) return;
    if (file.size > 1e6) {
      setMsg("bkMsg", "Plik jest zbyt duży.", "bad");
      return;
    }
    let raw;
    try {
      raw = JSON.parse(await file.text());
    } catch (e) {
      setMsg("bkMsg", "Plik nie jest poprawnym plikiem JSON.", "bad");
      return;
    }
    const v = validatePlan(raw);
    if (!v.ok) {
      setMsg("bkMsg", v.error, "bad");
      return;
    }
    openImportDialog(file.name, v.plan);
  };
}

function fmtImportSlot(c) {
  const hrs = fmtT(c.s) + "–" + fmtT(c.e);
  if (c.date) return c.date + " " + hrs;
  const wk = c.weeks && c.weeks !== "all" ? " (" + c.weeks + ")" : "";
  return (DOWS[c.wd] || "") + wk + " " + hrs;
}

function fmtDiffRow(item, plan) {
  const { old, next, diffs } = item;
  const lbl = typeLabel(plan, next.type);
  const parts = [];
  if (diffs.includes("time")) parts.push(fmtImportSlot(old) + " → " + fmtImportSlot(next));
  if (diffs.includes("room")) parts.push("sala " + (old.room || "brak") + " → " + (next.room || "brak"));
  if (diffs.includes("person")) parts.push((old.person || "brak") + " → " + (next.person || "brak"));
  return '<li class="chg"><b>' + esc(next.name) + "</b> (" + esc(lbl) + "): " + esc(parts.join(" · ")) + "</li>";
}

function openImportDialog(fileName, importedPlan) {
  const merged = mergeSchedule(cache.plan, importedPlan);
  const st = merged.ok ? merged.stats : null;
  let diffHtml = "";
  if (st) {
    const lines = [];
    for (const u of st.updated) lines.push(fmtDiffRow(u, merged.plan));
    for (const a of st.added) {
      lines.push(
        '<li class="add"><b>+ ' +
          esc(a.name) +
          "</b> (" +
          esc(typeLabel(merged.plan, a.type)) +
          "): " +
          esc(fmtImportSlot(a) + (a.room ? ", " + a.room : "")) +
          "</li>"
      );
    }
    for (const r of st.removed) {
      lines.push(
        '<li class="rem"><b>− ' +
          esc(r.name) +
          "</b> (" +
          esc(typeLabel(cache.plan, r.type)) +
          "): " +
          esc(fmtImportSlot(r)) +
          "</li>"
      );
    }
    const maxShow = 8;
    const shown = lines.slice(0, maxShow);
    if (lines.length > maxShow) {
      shown.push('<li class="more">…i jeszcze ' + (lines.length - maxShow) + " zmian</li>");
    }
    const summaryParts = [];
    if (st.updated.length) summaryParts.push(st.updated.length + " zaktualizowane");
    if (st.added.length) summaryParts.push(st.added.length + " dodane");
    if (st.removed.length) summaryParts.push(st.removed.length + " usunięte");
    if (st.typesChanged) summaryParts.push("zmienione typy/kolory");
    const summaryText = summaryParts.length
      ? "Wykryte zmiany: " + summaryParts.join(" · ")
      : "Plan zajęć w pliku jest identyczny z obecnym.";
    diffHtml =
      '<div class="imp-diff"><p class="imp-sum">' +
      esc(summaryText) +
      "</p>" +
      (shown.length ? "<ul>" + shown.join("") + "</ul>" : "") +
      "</div>";
  }

  openSheet(
    "Import planu",
    '<p class="shsub">Plik „' +
      esc(fileName) +
      "” (" +
      importedPlan.classes.length +
      " zajęć). Wybierz sposób wczytania:</p>" +
      diffHtml +
      '<p class="hint"><b>Aktualizacja samego planu</b> podmieni zajęcia oraz typy/kolory, a zachowa Twoje zadania, notatki przy przedmiotach, nieobecności, wyjątki, rytm A/B, powiadomienia i archiwum semestrów.</p>' +
      (merged.ok
        ? '<button type="button" class="btn pri blk" id="impMerge">Zaktualizuj tylko plan zajęć (zachowaj dane)</button>'
        : "") +
      '<button type="button" class="btn dng blk" id="impReplace">Zastąp cały plan (nadpisz wszystko)</button>' +
      '<button type="button" class="btn blk" data-sh="close">Anuluj</button>'
  );

  const applyImport = (nextPlan, okMsg) => {
    const before = cache.plan;
    try {
      commit(nextPlan);
    } catch (e) {
      toast("Nie udało się zaimportować: " + e.message);
      return;
    }
    closeSheet();
    toast(okMsg, "Cofnij", () => {
      try { commit(before); } catch (e) {}
    });
  };

  if ($("impMerge") && merged.ok) {
    $("impMerge").onclick = () => applyImport(merged.plan, "Zaktualizowano plan zajęć ✓");
  }
  $("impReplace").onclick = () => applyImport(importedPlan, "Zastąpiono cały plan ✓");
}

export function openConflict() {
  if (!conflict) return;
  ui.conflictShown = true;
  openSheet(
    "Konflikt zmian",
    '<p class="shsub">Plan na GitHubie zmienił się, a na tym urządzeniu masz niewysłane zmiany. Którą wersję zachować?</p>' +
      '<button type="button" class="btn blk" data-sh="cremote">Użyj wersji z GitHuba (moje zmiany zostaną utracone)</button>' +
      '<button type="button" class="btn blk" data-sh="clocal">Zachowaj moją wersję i nadpisz GitHuba</button>' +
      '<button type="button" class="btn blk" data-sh="close">Zdecyduj później</button>'
  );
}

/* ----- Archiwizacja ukończonych zadań i zarządzanie semestrami ----- */
export function archiveDoneTasks() {
  const done = cache.plan.tasks.filter((t) => isTaskDone(t, ui.now, cache.plan));
  if (!done.length) {
    toast("Brak ukończonych zadań do zarchiwizowania");
    return;
  }
  const ok = change((p) => {
    const keep = [];
    const moved = [];
    for (const t of p.tasks) {
      if (isTaskDone(t, ui.now, p)) {
        const copy = clone(t);
        copy.done = true;
        copy.label = taskLabelOf(t);
        moved.push(copy);
      } else keep.push(t);
    }
    p.tasks = keep;
    p.archivedTasks = (Array.isArray(p.archivedTasks) ? p.archivedTasks : []).concat(moved);
  }, "Zarchiwizowano ukończone zadania (" + done.length + ")");
  if (ok) openSettings();
}

export function openArchivedTasks() {
  const list = Array.isArray(cache.plan.archivedTasks) ? cache.plan.archivedTasks : [];
  const rows = list
    .slice()
    .reverse()
    .map(
      (t) =>
        '<div class="tk-row done"><div class="tk-body" style="padding-left:12px"><span class="tk-tx">' +
        catChip(t) +
        esc(t.text) +
        '</span><span class="tk-meta">' +
        esc(t.label || taskLabelOf(t)) +
        " · " +
        esc(taskMeta(t)) +
        '</span></div><div class="sem-acts" style="align-items:center;padding-right:8px"><button type="button" class="btn" data-sh="archrest:' +
        esc(t.id) +
        '">Przywróć</button><button type="button" class="tk-del" aria-label="Usuń z archiwum" data-sh="archdel:' +
        esc(t.id) +
        '">×</button></div></div>'
    )
    .join("");
  openSheet(
    "Archiwum zadań (" + list.length + ")",
    (list.length ? '<div class="tk-list">' + rows + "</div>" : '<p class="tk-empty">Archiwum zadań jest puste.</p>') +
      '<div class="acts"><button type="button" class="btn" data-sh="backset">Wróć do Ustawień</button><button type="button" class="btn" data-sh="close">Zamknij</button></div>'
  );
}

export function openNewSemester() {
  const curName = cache.plan.semester || "Semestr " + ((Array.isArray(cache.plan.semesters) ? cache.plan.semesters.length : 0) + 1);
  const nextNum = (Array.isArray(cache.plan.semesters) ? cache.plan.semesters.length : 0) + 2;
  openSheet(
    "Nowy semestr",
    '<p class="shsub">Bieżący plan zostanie zapisany w archiwum semestrów jako <b>' +
      esc(curName) +
      "</b>. Zawsze możesz do niego wrócić w Ustawieniach.</p>" +
      '<form id="nsf" novalidate autocomplete="off">' +
      '<label class="fl">Nazwa archiwizowanego semestru<input name="oldName" maxlength="60" value="' +
      esc(curName) +
      '"></label>' +
      '<label class="fl">Nazwa nowego semestru<input name="newName" maxlength="60" value="Semestr ' +
      nextNum +
      '" placeholder="np. Semestr 2 (lato 2027)"></label>' +
      '<label class="chkrow"><input type="checkbox" name="keepSubj"><span>Zachowaj notatki przedmiotów z obecnego semestru</span></label>' +
      '<p id="nsErr" class="msg bad" role="alert"></p>' +
      '<div class="acts"><button type="submit" class="btn pri">Zarchiwizuj i rozpocznij nowy</button><button type="button" class="btn" data-sh="backset">Anuluj</button></div></form>',
    'input[name="newName"]'
  );
  const f = $("nsf");
  f.onsubmit = (ev) => {
    ev.preventDefault();
    const oldName = f.elements.oldName.value.trim();
    const newName = f.elements.newName.value.trim();
    const keepSubj = f.elements.keepSubj.checked;
    if (!oldName || !newName) {
      $("nsErr").textContent = "Podaj obie nazwy semestrów.";
      return;
    }
    const ok = change((p) => {
      const snap = clone(p);
      delete snap.semesters;
      snap.semester = oldName;
      const sems = Array.isArray(p.semesters) ? p.semesters.slice() : [];
      sems.push({ id: uid(), name: oldName, savedAt: Date.now(), plan: snap });
      p.semester = newName;
      p.classes = [];
      p.exceptions = [];
      p.tasks = [];
      delete p.absences;
      delete p.absLimits;
      delete p.archivedTasks;
      if (!keepSubj) p.subjects = [];
      p.semesters = sems;
    }, "Rozpoczęto " + newName);
    if (ok) closeSheet();
  };
}

export function switchSemester(id) {
  const target = (cache.plan.semesters || []).find((s) => s.id === id);
  if (!target) return;
  const curName = cache.plan.semester || "Poprzedni semestr";
  const ok = change((p) => {
    const sems = Array.isArray(p.semesters) ? p.semesters.filter((s) => s.id !== id) : [];
    const curSnap = clone(p);
    delete curSnap.semesters;
    curSnap.semester = curName;
    sems.push({ id: uid(), name: curName, savedAt: Date.now(), plan: curSnap });

    const next = clone(target.plan);
    p.start = next.start;
    p.startWeek = next.startWeek;
    p.classes = next.classes || [];
    p.exceptions = next.exceptions || [];
    p.subjects = next.subjects || [];
    p.tasks = next.tasks || [];
    p.notif = next.notif || p.notif;
    p.semester = target.name;
    if (next.types && Object.keys(next.types).length) p.types = next.types;
    else delete p.types;
    if (next.dayOverrides && next.dayOverrides.length) p.dayOverrides = next.dayOverrides;
    else delete p.dayOverrides;
    if (next.absences && next.absences.length) p.absences = next.absences;
    else delete p.absences;
    if (next.absLimits && Object.keys(next.absLimits).length) p.absLimits = next.absLimits;
    else delete p.absLimits;
    if (next.archivedTasks && next.archivedTasks.length) p.archivedTasks = next.archivedTasks;
    else delete p.archivedTasks;
    p.semesters = sems;
  }, "Przełączono na: " + target.name);
  if (ok) openSettings();
}

export function deleteSemester(id) {
  const target = (cache.plan.semesters || []).find((s) => s.id === id);
  if (!target) return;
  ask("Usunąć zapisany semestr „" + target.name + "” z archiwum?", "Usuń semestr").then((yes) => {
    if (!yes) {
      openSettings();
      return;
    }
    change((p) => {
      p.semesters = (p.semesters || []).filter((s) => s.id !== id);
    }, "Usunięto semestr „" + target.name + "”");
    openSettings();
  });
}
