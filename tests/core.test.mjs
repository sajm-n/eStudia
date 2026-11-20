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
    text: "Kolos",
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
