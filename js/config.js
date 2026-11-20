/* ===== Stałe i konfiguracja aplikacji eStudia ===== */

export const APP_VERSION = "2.4.1";

export const TYPES = { w: "Wykład", l: "Laboratorium", c: "Ćwiczenia", x: "Inne" };
export const TYPE_ORDER = "wlcx";
export const TYPE_PAIRS = [
  ["w", "Wykład"],
  ["l", "Laboratorium"],
  ["c", "Ćwiczenia"],
  ["x", "Inne (bez kategorii)"],
];
export const REC_PAIRS = [
  ["all", "Co tydzień"],
  ["A", "Tylko w tygodniu A"],
  ["B", "Tylko w tygodniu B"],
  ["once", "Jednorazowo (konkretna data)"],
];

export const TASK_TYPES = {
  task: "Zadanie",
  exam: "Kolokwium",
  report: "Sprawozdanie",
  project: "Projekt",
};
export const TASK_TYPE_PAIRS = [
  ["task", "Zadanie"],
  ["exam", "Kolokwium"],
  ["report", "Sprawozdanie"],
  ["project", "Projekt"],
];

export const DOW = ["Poniedziałek", "Wtorek", "Środa", "Czwartek", "Piątek", "Sobota", "Niedziela"];
export const DOWS = ["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"];
export const WD_IN = ["w poniedziałek", "we wtorek", "w środę", "w czwartek", "w piątek", "w sobotę", "w niedzielę"];

export const TABS = { plan: "Plan zajęć", tasks: "Zadania", subj: "Przedmioty" };
export const GROUPS = [
  ["over", "Zaległe"],
  ["today", "Dzisiaj"],
  ["tomorrow", "Jutro"],
  ["afterTomorrow", "Pojutrze"],
  ["week", "Najbliższe 7 dni"],
  ["later", "Później"],
  ["done", "Zakończone"],
];

export const MAC_OPTS = [["yes", "Tak"], ["part", "Częściowo"], ["no", "Nie"], ["", "Nie wiem"]];
export const MAC_TXT = { yes: "tak", part: "częściowo", no: "nie" };

/* Klucze localStorage */
export const LSK = "plan.cache.v1";
export const CFK = "plan.cfg.v1";
export const TAB_KEY = "estudia.tab.v1";
export const TV_KEY = "estudia.tkview.v1";
export const HD_KEY = "estudia.hidedone.v1";
export const SEEN_KEY = "estudia.notified.v1";
export const PUSH_KEY = "estudia.pushsub.v1";
export const PUSHVAPID_KEY = "estudia.pushvapid.v1";
export const THEME_KEY = "estudia.theme.v1";

/* Domyślna konfiguracja synchronizacji z GitHubem */
export const CFG_DEF = {
  token: "",
  owner: "sajm-n",
  repo: "itplanzajec",
  path: "plan.json",
  branch: "main",
};

/* Powiadomienia Web Push (subskrypcje i stan zapisywane są na osobnej gałęzi technicznej) */
export const VAPID_PUBLIC = "BDi4iXQXPrUX2rtlRytZfam2Hs4DjZMsPHG5cUIBUNM0mpyqsOroYBtUWJZnyqeH6m1BEepygv_ZC0Fx9_6PqFY";
export const PUSH_FILE = "push-subscriptions.json";
export const PUSH_STATE_FILE = "push-state.json";
export const PUSH_BRANCH = "push-state";

/* Domyślne reguły powiadomień */
export const NOTIF_DEF = {
  onsite: { m: "day", days: 1, time: "18:00" },
  online: { m: "rel", min: 1440 },
};
export const REM_MAX_MIN = 60 * 1440; // 60 dni w minutach
export const OVERDUE_MS = 7 * 864e5;  // 7 dni

/* Plan domyślny (zawartość startowa) */
export const DEFAULT_PLAN = {
  v: 1,
  rev: 0,
  start: "2026-10-05",
  startWeek: "B",
  classes: [
    { id: "c01", name: "Podstawy programowania", type: "l", wd: 0, weeks: "all", s: "08:00", e: "11:15", room: "s. 202, WBiA", person: "mgr inż. P. Juszczyński" },
    { id: "c02", name: "Wprowadzenie do informatyki technicznej", type: "l", wd: 0, weeks: "all", s: "11:30", e: "13:00", room: "s. R515, CI", person: "mgr P. Miazek" },
    { id: "c03", name: "Grafika inżynierska i projektowanie w środowisku CAD", type: "w", wd: 0, weeks: "A", s: "15:00", e: "16:30", room: "Aula WZ/WMiIT", person: "dr inż. A. Urzędowski" },
    { id: "c04", name: "Język angielski I", type: "c", wd: 1, weeks: "all", s: "08:00", e: "09:30", room: "Ox 9", person: "" },
    { id: "c05", name: "Podstawy programowania", type: "w", wd: 1, weeks: "all", s: "09:45", e: "11:15", room: "Aula I, WM", person: "dr hab. P. Karczmarek" },
    { id: "c06", name: "Matematyka I", type: "w", wd: 1, weeks: "all", s: "11:30", e: "13:00", room: "Ox 130", person: "dr I. Gorgol" },
    { id: "c07", name: "Zielone technologie w IT", type: "l", wd: 1, weeks: "all", s: "13:15", e: "14:45", room: "Ox 28", person: "dr inż. J. Szulżyk-Cieplak" },
    { id: "c08", name: "Grafika inżynierska i projektowanie w środowisku CAD", type: "l", wd: 1, weeks: "all", s: "15:00", e: "17:30", room: "Ox 213", person: "dr inż. A. Urzędowski" },
    { id: "c09", name: "Kreowanie wizerunku i techniki autoprezentacji", type: "l", wd: 2, weeks: "all", s: "09:45", e: "11:15", room: "s. 10, AS", person: "mgr inż. M. Paśnikowska-Łukaszuk" },
    { id: "c10", name: "Wprowadzenie do informatyki technicznej", type: "w", wd: 2, weeks: "A", s: "11:30", e: "13:00", room: "Aula WZ/WMiIT", person: "dr hab. A. Kiersztyn" },
    { id: "c11", name: "Zielone technologie w IT", type: "w", wd: 2, weeks: "A", s: "13:15", e: "14:45", room: "Ox 15", person: "dr inż. J. Szulżyk-Cieplak" },
    { id: "c12", name: "Bezpieczeństwo i higiena pracy", type: "w", wd: 2, weeks: "B", s: "13:15", e: "14:45", room: "Ox 15", person: "mgr inż. A. Prus" },
    { id: "c13", name: "Matematyka I", type: "c", wd: 4, weeks: "all", s: "15:50", e: "18:15", room: "s. M402, WM", person: "mgr inż. M. Wieczorek" },
    { id: "c14", name: "Technologie informacyjne", type: "l", wd: 4, weeks: "all", s: "18:30", e: "20:00", room: "Ox 28", person: "mgr inż. K. Mróz" },
    { id: "o01", name: "Przysposobienie biblioteczne", type: "x", date: "2026-10-23", s: "11:30", e: "13:00", room: "s. 11, WM", person: "" },
  ],
  exceptions: [],
  subjects: [],
  tasks: [],
};
