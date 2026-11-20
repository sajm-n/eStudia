/* ===== Wspólny stan UI i drobne helpery DOM ===== */

import { TABS, TAB_KEY, TV_KEY, HD_KEY, THEME_KEY } from "./config.js";
import { day0, weekOf, isPre, itemsFor, pad, dk } from "./core.js";
import { cache } from "./sync.js";

export const $ = (id) => document.getElementById(id);

export const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const K = { w: "w", l: "l", c: "c2", x: "x" };
export const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Tryb desktopowy: komputer albo iPad poziomo (musi odpowiadać zapytaniu w CSS) */
export const mqD = matchMedia("(min-width:900px) and (orientation:landscape)");
export const isDesk = () => mqD.matches;

export const wk = (d) => weekOf(cache.plan, d);
export const pre = (d) => isPre(cache.plan, d);
export const items = (d) => itemsFor(cache.plan, d);

export const dl = (d) => d.toLocaleDateString("pl-PL", { day: "numeric", month: "long" });
export const dlong = (d) => d.toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" });
export const hm = (d) => pad(d.getHours()) + ":" + pad(d.getMinutes());
export const fmtLocal = (d) => dk(d) + "T" + hm(d);
export const nameLc = (s) => String(s || "").toLowerCase();
export const t5 = (v) => String(v || "").slice(0, 5);

export const lsSet = (k, v) => {
  try { localStorage.setItem(k, v); } catch (e) {}
};

export const selOpts = (pairs, cur) =>
  pairs
    .map((p) => '<option value="' + esc(p[0]) + '"' + (String(p[0]) === String(cur) ? " selected" : "") + ">" + esc(p[1]) + "</option>")
    .join("");

export function setMsg(id, text, kind) {
  const e = $(id);
  if (e) {
    e.textContent = text;
    e.className = "msg" + (kind ? " " + kind : "");
  }
}

let initialTab = "plan";
let initialTkView = "all";
let initialHideDone = false;
try {
  const t = localStorage.getItem(TAB_KEY);
  if (TABS[t]) initialTab = t;
  const tv = localStorage.getItem(TV_KEY);
  if (tv === "all" || tv === "onsite" || tv === "online") initialTkView = tv;
  initialHideDone = localStorage.getItem(HD_KEY) === "1";
} catch (e) {}

const startNow = new Date();

export const ui = {
  tab: initialTab,
  now: startNow,
  sel: day0(startNow),
  mo: new Date(startNow.getFullYear(), startNow.getMonth(), 1),
  vw: "day",
  calOpen: false,
  mcalOpen: false,
  mcalAnchor: "wk",
  lastFill: {},
  editMode: false,
  tkView: initialTkView,
  tkQuery: "",
  tkSubj: "",
  tkCat: "",
  hideDone: initialHideDone,
  olOpen: false,
  olAnim: null,
  ctx: {},
  shOpen: null,
  sjSave: null,
  conflictShown: false,
};

/* Prosta szyna wywołań między modułami UI (pozwala uniknąć zależności cyklicznych) */
export const app = {
  render() {},
  flushSave() {},
  openDetail() {},
  openTask() {},
  openOnsiteTask() {},
  openSubject() {},
  openForm() {},
  openOverride() {},
  openChooser() {},
  openSettings() {},
  openConflict() {},
};

/* ----- Motyw aplikacji (Systemowy / Jasny / Ciemny) ----- */
export function getTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "dark" || v === "light" ? v : "auto";
  } catch (e) {
    return "auto";
  }
}

export function applyTheme(val) {
  const v = val === "dark" || val === "light" ? val : "auto";
  const root = document.documentElement;
  if (v === "auto") {
    delete root.dataset.theme;
    try { localStorage.removeItem(THEME_KEY); } catch (e) {}
  } else {
    root.dataset.theme = v;
    lsSet(THEME_KEY, v);
  }
  const dark = v === "dark" || (v === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#10151f" : "#1f3a8a");
  return v;
}
