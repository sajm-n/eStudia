import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validatePlan,
  weekOf,
  itemsFor,
  overlaps,
  nextOccurrence,
  taskTrigger,
  taskAlert,
  taskGroup,
  taskCat,
  isExamTask,
  isTaskDone,
  examEndOf,
  absencesOf,
  isAbsentOn,
  absenceLimit,
  dayOverrideOf,
  dayOverrideTarget,
  taskTitle,
  taskSubjectName,
  tasksForClass,
  classForTask,
  nextOccurrenceBySubject,
  morningSummary,
  isLate,
  fromDK,
  dk,
  normT,
  normRule,
} from "../js/core.js";
import { DEFAULT_PLAN } from "../js/config.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("validatePlan: akceptuje DEFAULT_PLAN oraz rzeczywisty plan.json z repozytorium", () => {
  const d = validatePlan(DEFAULT_PLAN);
  assert.equal(d.ok, true);
  assert.equal(d.plan.classes.length, DEFAULT_PLAN.classes.length);

  const realRaw = JSON.parse(fs.readFileSync(path.join(ROOT, "plan.json"), "utf8"));
  const r = validatePlan(realRaw);
  assert.equal(r.ok, true, r.error || "");
  assert.ok(r.plan.classes.length > 0);
});

test("validatePlan: odrzuca nieprawidłowe dane i wycina uszkodzone wyjątki/zadania", () => {
  assert.equal(validatePlan(null).ok, false);
  assert.equal(validatePlan({ v: 2 }).ok, false);
  assert.equal(validatePlan({ v: 1, start: "2026-02-30", startWeek: "A", classes: [] }).ok, false);
  assert.equal(
    validatePlan({
      v: 1,
      start: "2026-10-05",
      startWeek: "A",
      classes: [{ id: "c1", name: "Test", type: "w", wd: 0, weeks: "all", s: "10:00", e: "09:00" }],
    }).ok,
    false
  );
});

test("weekOf: naprzemienność tygodni A/B przez zmianę czasu (DST)", () => {
  const plan = validatePlan(DEFAULT_PLAN).plan; // start 2026-10-05 = B
  assert.equal(weekOf(plan, fromDK("2026-10-05")), "B");
  assert.equal(weekOf(plan, fromDK("2026-10-12")), "A");
  assert.equal(weekOf(plan, fromDK("2026-10-19")), "B");
  // Po zmianie czasu na zimowy (ostatnia niedziela października 2026 = 2026-10-25)
  assert.equal(weekOf(plan, fromDK("2026-10-26")), "A");
  assert.equal(weekOf(plan, fromDK("2026-11-02")), "B");
  // Po zmianie czasu na letni (ostatnia niedziela marca 2027 = 2027-03-28; 25 tyg. po 2026-10-05 → nieparzysty = A)
  assert.equal(weekOf(plan, fromDK("2027-03-29")), "A");
  assert.equal(weekOf(plan, fromDK("2027-04-05")), "B");
});

test("itemsFor: uwzględnia tygodnie A/B, zajęcia jednorazowe i wyjątki (odwołanie / zmiana sali)", () => {
  const base = validatePlan(DEFAULT_PLAN).plan;
  base.exceptions.push(
    { id: "e1", cid: "c01", date: "2026-10-05", off: true },
    { id: "e2", cid: "c02", date: "2026-10-05", room: "s. 999" }
  );

  // 2026-10-05 = poniedziałek tygodnia B (c03 jest tylko w A, więc nie powinno go być)
  const monB = itemsFor(base, fromDK("2026-10-05"));
  assert.deepEqual(monB.map((x) => x.id), ["c01", "c02"]);
  assert.equal(monB[0].off, true);
  assert.equal(monB[1].c.room, "s. 999");

  // 2026-10-12 = poniedziałek tygodnia A (c03 powinno się pojawić)
  const monA = itemsFor(base, fromDK("2026-10-12"));
  assert.deepEqual(monA.map((x) => x.id), ["c01", "c02", "c03"]);

  // 2026-10-23 = jednorazowe o01
  const fri = itemsFor(base, fromDK("2026-10-23"));
  assert.ok(fri.some((x) => x.id === "o01"));
});

test("overlaps: wykrywa kolizje w czasie, ignorując różne tygodnie A vs B", () => {
  const plan = validatePlan(DEFAULT_PLAN).plan;
  // c03: poniedziałek 15:00-16:30 tylko w tygodniu A
  const clashA = overlaps(plan, { wd: 0, weeks: "A", s: "15:30", e: "16:00" });
  assert.equal(clashA.length, 1);
  assert.equal(clashA[0].id, "c03");

  const noClashB = overlaps(plan, { wd: 0, weeks: "B", s: "15:30", e: "16:00" });
  assert.equal(noClashB.length, 0);

  // Ignorowanie samego siebie przy edycji
  assert.equal(overlaps(plan, { wd: 0, weeks: "A", s: "15:30", e: "16:00" }, "c03").length, 0);
});

test("nextOccurrence: pomija odwołane zajęcia i znajduje kolejny termin", () => {
  const plan = validatePlan(DEFAULT_PLAN).plan;
  plan.exceptions.push({ id: "e1", cid: "c01", date: "2026-10-12", off: true });
  const nxt = nextOccurrence(plan, "c01", fromDK("2026-10-05"));
  assert.ok(nxt);
  assert.equal(dk(nxt.date), "2026-10-19");
  assert.equal(nxt.s, "08:00");
});

test("taskTrigger i taskAlert: reguły domyślne, relatywne i absolutne", () => {
  const notif = { onsite: { m: "day", days: 1, time: "18:00" }, online: { m: "rel", min: 1440 } };

  // Zadanie stacjonarne na 2026-11-23 o 11:30 → domyślne powiadomienie 2026-11-22 o 18:00
  const t1 = {
    id: "t1",
    kind: "onsite",
    text: "Zadanie 1",
    due: "2026-11-23",
    time: "11:30",
    at: new Date(2026, 10, 20, 10, 0).getTime(),
    done: false,
  };
  const trig = taskTrigger(t1, notif);
  assert.equal(dk(trig.start), "2026-11-22");
  assert.equal(trig.start.getHours(), 18);
  assert.equal(trig.start.getMinutes(), 0);

  assert.equal(taskAlert(t1, new Date(2026, 10, 22, 17, 59), notif), null);
  assert.equal(taskAlert(t1, new Date(2026, 10, 22, 18, 0), notif), "soon");
  assert.equal(taskAlert(t1, new Date(2026, 10, 23, 11, 31), notif), "over");

  // Zadanie dodane PO chwili wyzwolenia powiadomienia nie alarmuje od razu
  const tLateAdded = { ...t1, at: new Date(2026, 10, 22, 19, 0).getTime() };
  assert.equal(taskAlert(tLateAdded, new Date(2026, 10, 22, 19, 5), notif), null);

  // Zadanie z własną regułą "rel" 30 min przed terminem
  const tRel = { ...t1, rem: normRule({ m: "rel", min: 30 }, true) };
  assert.equal(taskAlert(tRel, new Date(2026, 10, 23, 10, 59), notif), null);
  assert.equal(taskAlert(tRel, new Date(2026, 10, 23, 11, 0), notif), "soon");
});

test("isLate: spójność z endOf dla zadań online i onsite", () => {
  const now = new Date(2026, 10, 23, 12, 0);
  assert.equal(isLate({ kind: "onsite", due: "2026-11-23", time: "11:30", done: false }, now), true);
  assert.equal(isLate({ kind: "onsite", due: "2026-11-23", time: "11:30", done: true }, now), false);
  assert.equal(isLate({ kind: "online", due: "2026-11-23", time: "", done: false }, now), false); // domyślnie 23:59
  assert.equal(normT("8:05"), "08:05");
  assert.equal(normT("25:00"), null);
});

test("taskGroup: ruchomy horyzont w niedzielę (poniedziałek=Jutro, wtorek=Pojutrze, śr-nd=Najbliższe 7 dni)", () => {
  const sunday = new Date(2026, 10, 22, 18, 0); // niedziela 22.11.2026
  assert.equal(taskGroup({ due: "2026-11-21", done: false }, sunday), "over");
  assert.equal(taskGroup({ due: "2026-11-22", done: false }, sunday), "today");
  assert.equal(taskGroup({ due: "2026-11-23", done: false }, sunday), "tomorrow");
  assert.equal(taskGroup({ due: "2026-11-24", done: false }, sunday), "afterTomorrow");
  assert.equal(taskGroup({ due: "2026-11-25", done: false }, sunday), "week");
  assert.equal(taskGroup({ due: "2026-11-29", done: false }, sunday), "week");
  assert.equal(taskGroup({ due: "2026-11-30", done: false }, sunday), "later");
  assert.equal(taskGroup({ due: "2026-11-23", done: true }, sunday), "done");
});

test("taskCat, isExamTask i validatePlan: zachowanie kategorii zadań i wykrywanie kolokwiów", () => {
  const raw = {
    ...DEFAULT_PLAN,
    tasks: [
      { id: "t1", kind: "online", text: "Kolos z algebry", due: "2026-11-23", done: false },
      { id: "t2", kind: "onsite", text: "Ćwiczenie 4", due: "2026-11-24", cat: "exam", done: false },
      { id: "t3", kind: "onsite", text: "Lab 5", due: "2026-11-25", cat: "report", done: false },
      { id: "t4", kind: "online", text: "Aplikacja", due: "2026-11-26", cat: "project", done: false },
      { id: "t5", kind: "online", text: "Zwykłe", due: "2026-11-27", cat: "task", done: false },
    ],
  };
  const v = validatePlan(raw);
  assert.equal(v.ok, true);
  assert.equal(taskCat(v.plan.tasks[0]), "task");
  assert.equal(isExamTask(v.plan.tasks[0]), true); // wykryte po słowie „Kolos”
  assert.equal(v.plan.tasks[1].cat, "exam");
  assert.equal(isExamTask(v.plan.tasks[1]), true);
  assert.equal(v.plan.tasks[2].cat, "report");
  assert.equal(isExamTask(v.plan.tasks[2]), false);
  assert.equal(v.plan.tasks[3].cat, "project");
  assert.equal(v.plan.tasks[4].cat, undefined); // domyślne „task” nie zaśmieca JSON-a
});

test("absences, absLimits, archivedTasks i semesters: walidacja i helpery v2.4", () => {
  const raw = {
    ...DEFAULT_PLAN,
    semester: "Semestr 1 (2026/27)",
    absences: [
      { cid: "c01", date: "2026-10-12" },
      { cid: "c01", date: "2026-10-12" }, // duplikat
      { cid: "c01", date: "2026-10-19" },
      { cid: "nieistniejace", date: "2026-10-19" }, // powinno zostać wycięte
    ],
    absLimits: { c01: 3, c05: 1, nieistniejace: 5 },
    archivedTasks: [
      { id: "a1", kind: "online", text: "Stary quiz", due: "2026-10-15", done: true, label: "Matematyka I" },
    ],
    semesters: [
      { id: "s1", name: "Semestr 0", savedAt: 1700000000000, plan: DEFAULT_PLAN },
    ],
  };
  const v = validatePlan(raw);
  assert.equal(v.ok, true);
  assert.equal(v.plan.semester, "Semestr 1 (2026/27)");
  assert.deepEqual(absencesOf(v.plan, "c01"), ["2026-10-12", "2026-10-19"]);
  assert.equal(isAbsentOn(v.plan, "c01", "2026-10-12"), true);
  assert.equal(isAbsentOn(v.plan, "c01", "2026-10-26"), false);
  // c01 ma nadpisany limit 3; c02 (lab) domyślnie 2; c05 (wykład) ma nadpisany 1; c03 (wykład) domyślnie null
  assert.equal(absenceLimit(v.plan, v.plan.classes.find((c) => c.id === "c01")), 3);
  assert.equal(absenceLimit(v.plan, v.plan.classes.find((c) => c.id === "c02")), 2);
  assert.equal(absenceLimit(v.plan, v.plan.classes.find((c) => c.id === "c05")), 1);
  assert.equal(absenceLimit(v.plan, v.plan.classes.find((c) => c.id === "c03")), null);
  assert.equal(v.plan.archivedTasks.length, 1);
  assert.equal(v.plan.archivedTasks[0].label, "Matematyka I");
  assert.equal(v.plan.semesters.length, 1);
  assert.equal(v.plan.semesters[0].name, "Semestr 0");
});

test("dayOverrides (nadpisanie, zamiana, dzień wolny) oraz jednorazowe przeniesienie zajęć (toDate)", () => {
  // 2026-11-11 = środa (tydzień A: c09, c10, c11), 2026-11-13 = piątek (c13, c14)
  const raw = {
    ...DEFAULT_PLAN,
    dayOverrides: [
      { date: "2026-11-11", off: true, note: "Przeniesiono na 13 listopada" },
      { date: "2026-11-13", fromDate: "2026-11-11" },
    ],
    exceptions: [
      // Przenieś poniedziałkowe c01 (2026-11-16) jednorazowo na czwartek (2026-11-19) na 14:00-17:15
      { id: "ex1", cid: "c01", date: "2026-11-16", toDate: "2026-11-19", s: "14:00", e: "17:15" },
    ],
  };
  const v = validatePlan(raw);
  assert.equal(v.ok, true);
  const p = v.plan;

  assert.equal(dayOverrideOf(p, "2026-11-11").off, true);
  assert.equal(dayOverrideOf(p, "2026-11-13").fromDate, "2026-11-11");
  assert.equal(dayOverrideTarget(p, "2026-11-11"), "2026-11-13");
  assert.equal(dayOverrideTarget(p, "2026-11-13"), "2026-11-11");

  // Środa 11.11 pusta, piątek 13.11 ma zajęcia ze środy 11.11, a kolejny piątek 20.11 bez zmian!
  assert.deepEqual(itemsFor(p, fromDK("2026-11-11")).map((x) => x.id), []);
  assert.deepEqual(itemsFor(p, fromDK("2026-11-13")).map((x) => x.id), ["c09", "c10", "c11"]);
  assert.deepEqual(itemsFor(p, fromDK("2026-11-20")).map((x) => x.id), ["c13", "c14"]);

  // Zamiana dni (swap): 2026-11-11 ↔ 2026-11-13
  const pSwap = validatePlan({
    ...DEFAULT_PLAN,
    dayOverrides: [
      { date: "2026-11-11", fromDate: "2026-11-13" },
      { date: "2026-11-13", fromDate: "2026-11-11" },
    ],
  }).plan;
  assert.deepEqual(itemsFor(pSwap, fromDK("2026-11-11")).map((x) => x.id), ["c13", "c14"]);
  assert.deepEqual(itemsFor(pSwap, fromDK("2026-11-13")).map((x) => x.id), ["c09", "c10", "c11"]);

  // Jednorazowe przeniesienie pojedynczych zajęć (c01 z 16.11 na 19.11)
  assert.equal(itemsFor(p, fromDK("2026-11-16")).some((x) => x.id === "c01"), false);
  const thu = itemsFor(p, fromDK("2026-11-19"));
  const moved = thu.find((x) => x.id === "c01");
  assert.ok(moved);
  assert.equal(moved.movedFrom, "2026-11-16");
  assert.equal(moved.origDate, "2026-11-16");
  assert.equal(moved.c.s, "14:00");
  assert.equal(moved.c.e, "17:15");
});

test("v2.6: niezależne zadania, dopasowanie czasowe do zajęć, kolokwium/sprawozdanie bez nazwy", () => {
  const raw = {
    ...DEFAULT_PLAN,
    subjects: [
      { id: "s1", name: "Podstawy programowania", desc: "", req: "", forms: {}, mac: "" },
      { id: "s2", name: "Matematyka I", desc: "", req: "", forms: {}, mac: "" },
    ],
    tasks: [
      // Kolokwium bez nazwy, z samym opisem, w godzinach zajęć c01 (pon 08:00-11:15)
      { id: "tex", cat: "exam", text: "", note: "Pętle, tablice, wskaźniki", sid: "s1", due: "2026-11-23", time: "08:30", done: false },
      // Sprawozdanie bez nazwy z linkiem
      { id: "trep", cat: "report", text: "", note: "Lab 5", url: "https://example.com/lab5", sid: "s1", due: "2026-11-23", time: "09:00", done: false },
      // Zadanie bez nazwy typu task — powinno zostać odrzucone
      { id: "tbad", text: "", due: "2026-11-23", done: false },
      // Zadanie z innego przedmiotu w tych samych godzinach — nie powinno przypiąć się do c01
      { id: "tother", text: "Zadania z całek", sid: "s2", due: "2026-11-23", time: "09:00", done: false },
      // Zadanie całodniowe (bez godziny) — nie powinno przypinać się do zajęć
      { id: "tallday", text: "Przeczytać rozdział 2", sid: "s1", due: "2026-11-23", time: "", done: false },
      // Zadanie bez przedmiotu w godzinach c01 — powinno zostać wyłapane przez c01
      { id: "tnosubj", text: "Oddać pendrive", sid: "", due: "2026-11-23", time: "10:00", done: false },
    ],
  };
  const v = validatePlan(raw);
  assert.equal(v.ok, true);
  const p = v.plan;

  assert.equal(p.tasks.some((t) => t.id === "tex"), true);
  assert.equal(p.tasks.some((t) => t.id === "trep"), true);
  assert.equal(p.tasks.some((t) => t.id === "tbad"), false);
  assert.equal(p.tasks.find((t) => t.id === "trep").url, "https://example.com/lab5");

  assert.equal(taskTitle(p.tasks.find((t) => t.id === "tex")), "Kolokwium");
  assert.equal(taskTitle(p.tasks.find((t) => t.id === "trep")), "Sprawozdanie");
  assert.equal(taskSubjectName(p, p.tasks.find((t) => t.id === "tex")), "Podstawy programowania");

  const mon = itemsFor(p, fromDK("2026-11-23"));
  const c01 = mon.find((x) => x.id === "c01");
  const matched = tasksForClass(p, c01).map((t) => t.id);
  assert.deepEqual(matched, ["tex", "trep", "tnosubj"]);

  assert.equal(classForTask(p, p.tasks.find((t) => t.id === "tex")).id, "c01");
  assert.equal(classForTask(p, p.tasks.find((t) => t.id === "tallday")), null);

  const nextMath = nextOccurrenceBySubject(p, "Matematyka I", new Date(2026, 10, 23, 8, 0));
  assert.ok(nextMath);
  assert.equal(nextMath.dk, "2026-11-24");
  assert.equal(nextMath.s, "11:30");

  // Przełożenie z laboratorium Podstawy programowania (pon 23.11) musi znaleźć kolejne laboratorium (pon 30.11), a nie wykład (wt 24.11)
  const nextLab = nextOccurrenceBySubject(p, "Podstawy programowania", new Date(2026, 10, 24, 0, 0), { cid: "c01", type: "l" });
  assert.ok(nextLab);
  assert.equal(nextLab.cid, "c01");
  assert.equal(nextLab.dk, "2026-11-30");
  assert.equal(nextLab.s, "08:00");
});

test("v2.7b: morningSummary generuje poranny skrót dnia i respektuje dni wolne", () => {
  const v = validatePlan({
    ...DEFAULT_PLAN,
    notif: { morning: { on: true, time: "07:15" } },
    tasks: [
      { id: "ex1", cat: "exam", text: "", note: "Całki", due: "2026-11-23", time: "08:00", done: false },
      { id: "tk1", text: "Oddać sprawozdanie", due: "2026-11-23", time: "10:00", done: false },
    ],
  });
  assert.equal(v.ok, true);
  assert.deepEqual(v.plan.notif.morning, { on: true, time: "07:15" });

  // Poniedziałek 23.11 ma zajęcia (start 8:00) + 1 kolokwium + 1 zadanie
  const mon = morningSummary(v.plan, fromDK("2026-11-23"));
  assert.ok(mon);
  assert.match(mon.body, /start 8:00/);
  assert.match(mon.body, /1 kolokwium/);
  assert.match(mon.body, /1 zadanie/);

  // Sobota 21.11 nie ma zajęć ani zadań -> null (nie wysyła pustego powiadomienia)
  assert.equal(morningSummary(v.plan, fromDK("2026-11-21")), null);
});

test("v2.8.2: typ zajęć Projekt (p) w walidacji planu, wymaganiach przedmiotu i limicie nieobecności", () => {
  const v = validatePlan({
    ...DEFAULT_PLAN,
    classes: [
      ...DEFAULT_PLAN.classes,
      { id: "p01", name: "Projekt zespołowy", type: "p", wd: 3, weeks: "all", s: "10:00", e: "11:30", room: "s. 105", person: "dr Nowak" },
    ],
    subjects: [
      { id: "sp1", name: "Projekt zespołowy", desc: "", req: "", forms: { p: { req: "Oddanie aplikacji", desc: "Konsultacje w czwartki" } }, mac: "yes" },
    ],
  });
  assert.equal(v.ok, true);
  const cls = v.plan.classes.find((c) => c.id === "p01");
  assert.ok(cls);
  assert.equal(cls.type, "p");
  assert.equal(absenceLimit(v.plan, cls), 2);
  assert.equal(v.plan.subjects[0].forms.p.req, "Oddanie aplikacji");
});

test("v2.8.4: kolokwia i sesje kończą się automatycznie po odbyciu i nie generują alertu po terminie", () => {
  const notif = { task: { m: "day", days: 1, time: "18:00" } };
  const v = validatePlan({
    ...DEFAULT_PLAN,
    subjects: [{ id: "s1", name: "Podstawy programowania", desc: "", req: "", forms: {}, mac: "" }],
    tasks: [
      // Kolokwium na poniedziałkowym labie c01 (08:00–11:15)
      { id: "ex1", cat: "exam", text: "", note: "Pętle i tablice", sid: "s1", due: "2026-11-23", time: "08:00", at: new Date(2026, 10, 20, 10, 0).getTime(), done: false },
      // Sesja poza zajęciami (sobota 10:00)
      { id: "ses1", cat: "session", text: "", note: "Egzamin końcowy", sid: "s1", due: "2026-11-28", time: "10:00", at: new Date(2026, 10, 20, 10, 0).getTime(), done: false },
      // Sesja całodniowa (bez godziny)
      { id: "ses2", cat: "session", text: "", note: "Termin zerowy", sid: "s1", due: "2026-11-29", time: "", at: new Date(2026, 10, 20, 10, 0).getTime(), done: false },
    ],
  });
  assert.equal(v.ok, true);
  const p = v.plan;
  const ex1 = p.tasks.find((t) => t.id === "ex1");
  const ses1 = p.tasks.find((t) => t.id === "ses1");
  const ses2 = p.tasks.find((t) => t.id === "ses2");

  assert.equal(isExamTask(ex1), true);
  assert.equal(isExamTask(ses1), true);
  assert.equal(taskCat(ses1), "session");
  assert.equal(taskTitle(ses1), "Sesja");

  // Kolokwium w trakcie zajęć c01 (08:00–11:15): koniec = 11:15
  const exEnd = examEndOf(p, ex1);
  assert.equal(exEnd.getHours(), 11);
  assert.equal(exEnd.getMinutes(), 15);
  assert.equal(isTaskDone(ex1, new Date(2026, 10, 23, 10, 0), p), false);
  assert.equal(isTaskDone(ex1, new Date(2026, 10, 23, 11, 15), p), true);
  assert.equal(taskGroup(ex1, new Date(2026, 10, 23, 11, 15), p), "done");
  assert.equal(isLate(ex1, new Date(2026, 10, 23, 11, 20), p), false);

  // Alert: przed kolokwium "soon", po rozpoczęciu / odbyciu brak alertu "over"
  assert.equal(taskAlert(ex1, new Date(2026, 10, 22, 18, 0), notif, p), "soon");
  assert.equal(taskAlert(ex1, new Date(2026, 10, 23, 8, 5), notif, p), null);
  assert.equal(taskAlert(ex1, new Date(2026, 10, 23, 12, 0), notif, p), null);

  // Sesja samodzielna z godziną 10:00: aktywna o 9:59, odbyta o 10:00
  assert.equal(isTaskDone(ses1, new Date(2026, 10, 28, 9, 59), p), false);
  assert.equal(isTaskDone(ses1, new Date(2026, 10, 28, 10, 0), p), true);
  assert.equal(taskGroup(ses1, new Date(2026, 10, 28, 10, 0), p), "done");
  assert.equal(taskAlert(ses1, new Date(2026, 10, 27, 18, 0), notif, p), "soon");
  assert.equal(taskAlert(ses1, new Date(2026, 10, 28, 10, 5), notif, p), null);

  // Sesja całodniowa (bez godziny): aktywna o 23:58, odbyta o 23:59
  assert.equal(isTaskDone(ses2, new Date(2026, 10, 29, 23, 58), p), false);
  assert.equal(isTaskDone(ses2, new Date(2026, 10, 29, 23, 59), p), true);

  // Poranny skrót dnia rozróżnia sesję
  const sat = morningSummary(p, new Date(2026, 10, 28, 7, 30));
  assert.ok(sat);
  assert.match(sat.body, /1 sesja/);
});

