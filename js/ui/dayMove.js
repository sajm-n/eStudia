/* ===== Zmiany jednorazowe zajęć, przenoszenie/zamiana całych dni i wybór akcji w trybie edycji ===== */

import { dk, fromDK, normT, mn, fmtT, uid, itemsFor, tasksForClass } from "../core.js";
import { cache } from "../sync.js";
import { $, esc, items, dl, dlong, t5, ui, app } from "../state.js";
import { openSheet, closeSheet, change } from "./sheet.js";

/* Zmiana tylko w jednym dniu (w tym jednorazowe przeniesienie na inną datę) */
export function openOverride(cid, date) {
  const d = fromDK(date);
  const it = items(d).find((x) => x.id === cid);
  if (!it) return;
  const origDate = it.origDate || date;
  ui.ctx = { cid, date, origDate };
  const c = it.c;
  const relatedTasks = tasksForClass(cache.plan, it).filter((t) => !t.done);
  const relatedIds = new Set(relatedTasks.map((t) => t.id));
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
      if (moveTasks && relatedIds.size) {
        for (const t of p.tasks) {
          if (relatedIds.has(t.id) && !t.done) {
            t.due = toDate;
            t.time = s;
            if (t.date) t.date = toDate;
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
    const dayTaskIds = (dKey) => {
      const out = new Set();
      const dObj = fromDK(dKey);
      if (!dObj) return out;
      for (const it of itemsFor(cache.plan, dObj)) {
        if (it.off) continue;
        for (const t of tasksForClass(cache.plan, it)) {
          if (!t.done) out.add(t.id);
        }
      }
      return out;
    };
    const idsA = dayTaskIds(a);
    const idsB = mode === "swap" ? dayTaskIds(b) : new Set();
    const cnt = idsA.size + idsB.size;
    $("dmTaskWrap").hidden = !cnt;
    if (cnt) {
      $("dmTaskLbl").textContent =
        "Przenieś też terminy zadań z zajęć (" + cnt + ") — odznaczone zachowuje pierwotne daty";
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

    const dayTaskIds = (dKey) => {
      const out = new Set();
      const dObj = fromDK(dKey);
      if (!dObj) return out;
      for (const it of itemsFor(cache.plan, dObj)) {
        if (it.off) continue;
        for (const t of tasksForClass(cache.plan, it)) {
          if (!t.done) out.add(t.id);
        }
      }
      return out;
    };
    const moveA = moveTasks ? dayTaskIds(a) : new Set();
    const moveB = moveTasks && mode === "swap" ? dayTaskIds(b) : new Set();

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
        list.push({ date: a, off: true, toDate: b, note: "Przeniesiono na " + dl(fromDK(b)) });
        list.push({ date: b, fromDate: a });
      } else {
        list.push({ date: a, fromDate: b });
        list.push({ date: b, fromDate: a });
      }
      p.dayOverrides = list;

      if (moveTasks && (moveA.size || moveB.size)) {
        for (const t of p.tasks) {
          if (t.done) continue;
          if (moveA.has(t.id)) {
            t.due = b;
            if (t.date) t.date = b;
          } else if (moveB.has(t.id)) {
            t.due = a;
            if (t.date) t.date = a;
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

