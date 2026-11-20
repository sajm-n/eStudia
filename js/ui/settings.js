/* ===== Ustawienia, domyślne powiadomienia, kopia zapasowa, status synchronizacji i konflikty ===== */

import { APP_VERSION, WD_IN } from "../config.js";
import { pad, day0, wd, dk, fromDK, normT, fmtT, mondayOf, validatePlan, ruleStart } from "../core.js";
import { cfg, cache, sync, conflict, saveCfg, resetSyncTarget, commit, syncAll, testToken } from "../sync.js";
import { ensurePush, renderNotifState, renderPushDiag } from "../push.js";
import { $, esc, dl, hm, selOpts, setMsg, getTheme, ui } from "../state.js";
import { openSheet, closeSheet, toast, ask, change } from "./sheet.js";
import { fmtDur } from "./tasks.js";

export function syncText() {
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

function dfExample(kind, r) {
  const x = day0(new Date());
  let end = new Date(x.getFullYear(), x.getMonth(), x.getDate() + 3, 10, 0);
  while (wd(end) !== 0) end = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1, 10, 0);
  let s = ruleStart(r, day0(end), end);
  if (s > end) s = end;
  return (
    "Przykład: " +
    (kind === "onsite" ? "zajęcia" : "termin") +
    " " +
    WD_IN[0] +
    " o 10:00 → powiadomienie " +
    WD_IN[wd(s)] +
    " o " +
    fmtT(hm(s)) +
    "."
  );
}

export function dfRender() {
  const box = $("dfBox");
  if (!box) return;
  const n = cache.plan.notif;
  const rows = [
    ["onsite", "Zadania stacjonarne"],
    ["online", "Zadania online"],
  ];
  box.innerHTML = rows
    .map((o) => {
      const r = n[o[0]];
      return (
        '<div class="dfb"><label class="fl">' +
        o[1] +
        '<select name="' +
        o[0] +
        '">' +
        dfSelect(r) +
        '</select></label><label class="fl" data-tm="' +
        o[0] +
        '"' +
        (r.m === "day" ? "" : " hidden") +
        '>Godzina powiadomienia<input type="time" name="' +
        o[0] +
        'T" value="' +
        esc(r.m === "day" ? r.time : "18:00") +
        '"></label><p class="hint" data-ex="' +
        o[0] +
        '">' +
        esc(dfExample(o[0], r)) +
        "</p></div>"
      );
    })
    .join("");
  const save = (kind) => {
    const E = $("dfF").elements;
    const r = dfRead(kind);
    box.querySelector('[data-tm="' + kind + '"]').hidden = E[kind].value.startsWith("rel:");
    if (!r) {
      setMsg("dfMsg", "Podaj godzinę powiadomienia.", "bad");
      return;
    }
    box.querySelector('[data-ex="' + kind + '"]').textContent = dfExample(kind, r);
    if (JSON.stringify(cache.plan.notif[kind]) === JSON.stringify(r)) {
      if ($("dfMsg").classList.contains("bad")) setMsg("dfMsg", "");
      return;
    }
    const ok = change((p) => {
      p.notif[kind] = r;
    });
    setMsg("dfMsg", ok ? "Zapisano ✓" : "Nie udało się zapisać.", ok ? "ok" : "bad");
  };
  for (const kind of ["onsite", "online"]) {
    const E = $("dfF").elements;
    E[kind].onchange = () => save(kind);
    E[kind + "T"].onchange = () => save(kind);
  }
}

export function openSettings() {
  const c = cfg;
  const p = cache.plan;
  const curTheme = getTheme();
  const themeBtns = [
    ["auto", "Systemowy"],
    ["light", "Jasny"],
    ["dark", "Ciemny"],
  ]
    .map(
      (o) =>
        '<button type="button" data-sh="theme:' +
        o[0] +
        '" class="' +
        (curTheme === o[0] ? "on" : "") +
        '" aria-pressed="' +
        (curTheme === o[0]) +
        '">' +
        o[1] +
        "</button>"
    )
    .join("");
  openSheet(
    "Ustawienia",
    '<p class="shsub" id="cfgStat" role="status"></p>' +
      '<h3 class="sec">Wygląd</h3>' +
      '<div class="seg remseg" id="themeSeg" role="group" aria-label="Motyw aplikacji">' +
      themeBtns +
      "</div>" +
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
      '<h3 class="sec">Kopia zapasowa</h3>' +
      '<div class="acts"><button type="button" class="btn" data-sh="export">Eksportuj plan</button><button type="button" class="btn" data-sh="import">Importuj plan</button><button type="button" class="btn dng" data-sh="reset">Przywróć plan domyślny</button></div>' +
      '<input type="file" id="impf" accept=".json,application/json" hidden>' +
      '<p id="bkMsg" class="msg" role="status" style="margin-top:8px"></p>' +
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
    if (!(await ask("Zastąpić obecny plan planem z pliku „" + file.name + "”?", "Zastąp plan"))) return;
    const before = cache.plan;
    try {
      commit(v.plan);
    } catch (e) {
      toast("Nie udało się zaimportować: " + e.message);
      return;
    }
    closeSheet();
    toast("Zaimportowano plan", "Cofnij", () => {
      try { commit(before); } catch (e) {}
    });
  };
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
