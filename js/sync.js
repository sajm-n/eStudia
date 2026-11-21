/* ===== Ustawienia, pamięć lokalna, synchronizacja z GitHub ===== */

import { CFG_DEF, CFK, LSK, DEV_KEY, DEV_LSK, DEFAULT_PLAN } from "./config.js";
import { clone, serialize, validatePlan } from "./core.js";

let devMode = false;
try {
  devMode = localStorage.getItem(DEV_KEY) === "1";
} catch (e) {}

export const isDevMode = () => devMode;

export function loadCfg() {
  const c = Object.assign({}, CFG_DEF);
  try {
    const o = JSON.parse(localStorage.getItem(CFK));
    if (o && typeof o === "object") {
      for (const k in CFG_DEF) {
        if (typeof o[k] === "string") c[k] = o[k];
      }
      if (c.owner === "sajm-n" && c.repo === "itplanzajec") {
        c.repo = "eStudia";
        localStorage.setItem(CFK, JSON.stringify(c));
      }
    }
  } catch (e) {}
  return c;
}

function loadRealCache() {
  try {
    const o = JSON.parse(localStorage.getItem(LSK));
    const v = validatePlan(o && o.plan);
    if (v.ok) {
      return { plan: v.plan, sha: typeof o.sha === "string" ? o.sha : null, dirty: !!o.dirty };
    }
  } catch (e) {}
  return { plan: validatePlan(clone(DEFAULT_PLAN)).plan, sha: null, dirty: false };
}

export function loadCache() {
  if (devMode) {
    try {
      const o = JSON.parse(localStorage.getItem(DEV_LSK));
      const v = validatePlan(o && o.plan);
      if (v.ok) return { plan: v.plan, sha: null, dirty: false };
    } catch (e) {}
    return { plan: clone(loadRealCache().plan), sha: null, dirty: false };
  }
  return loadRealCache();
}

export let cfg = loadCfg();
export let cache = loadCache();
export let conflict = null;
let pushing = false;
let pushAgain = false;
let pulling = false;
let pushTimer = 0;

export let sync = { state: devMode ? "dev" : "idle", msg: "", at: 0 };
export const hooks = { sync() {}, changed() {}, conflict() {}, adopted() {} };

/* Tryb pracy: "dev" = odizolowany playground; bez tokena = lokalny; z tokenem = serwerowy */
export const mode = () => (devMode ? "dev" : cfg.token ? "cloud" : "local");

export function setSync(state, msg) {
  sync = { state, msg: msg || "", at: Date.now() };
  hooks.sync();
}

export function persist() {
  try {
    if (devMode) {
      localStorage.setItem(DEV_LSK, JSON.stringify({ plan: cache.plan }));
    } else {
      localStorage.setItem(LSK, JSON.stringify({ plan: cache.plan, sha: cache.sha, dirty: cache.dirty }));
    }
  } catch (e) {}
}

/* Odizolowany tryb deweloperski (playground): prawdziwy plan (LSK) i GitHub są całkowicie nietknięte */
export function enterDevMode(rawPlan) {
  clearTimeout(pushTimer);
  let nextPlan = null;
  if (rawPlan !== undefined) {
    const v = validatePlan(rawPlan);
    if (!v.ok) return { ok: false, error: v.error };
    nextPlan = v.plan;
  } else if (!devMode) {
    nextPlan = clone(cache.plan);
  }
  devMode = true;
  conflict = null;
  try {
    localStorage.setItem(DEV_KEY, "1");
  } catch (e) {}
  if (nextPlan) cache.plan = nextPlan;
  cache.sha = null;
  cache.dirty = false;
  persist();
  setSync("dev");
  hooks.changed();
  return { ok: true, plan: cache.plan };
}

export function loadDevPlan(rawPlan) {
  return enterDevMode(rawPlan);
}

export function exitDevMode() {
  if (!devMode) return false;
  clearTimeout(pushTimer);
  devMode = false;
  conflict = null;
  try {
    localStorage.removeItem(DEV_KEY);
    localStorage.removeItem(DEV_LSK);
  } catch (e) {}
  const real = loadRealCache();
  cache.plan = real.plan;
  cache.sha = real.sha;
  cache.dirty = real.dirty;
  setSync(cfg.token ? "idle" : "local");
  hooks.changed();
  return true;
}

export function saveCfg(c) {
  cfg = Object.assign({}, CFG_DEF, c);
  try {
    localStorage.setItem(CFK, JSON.stringify(cfg));
  } catch (e) {}
}

export function resetSyncTarget() {
  if (devMode) return;
  cache.sha = null;
  conflict = null;
  persist();
}

export function clearTokenState() {
  saveCfg(Object.assign({}, cfg, { token: "" }));
  conflict = null;
  clearTimeout(pushTimer);
  setSync(devMode ? "dev" : "local");
}

export const b64e = (s) => {
  const b = new TextEncoder().encode(s);
  let r = "";
  for (const x of b) r += String.fromCharCode(x);
  return btoa(r);
};

export const b64d = (s) => {
  const r = atob(String(s).replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(r, (c) => c.charCodeAt(0)));
};

export function ghFileUrl(path) {
  return (
    "https://api.github.com/repos/" +
    encodeURIComponent(cfg.owner) +
    "/" +
    encodeURIComponent(cfg.repo) +
    "/contents/" +
    path.split("/").map(encodeURIComponent).join("/")
  );
}

export function ghFile(path, method, body, branch = cfg.branch) {
  const h = { Accept: "application/vnd.github+json" };
  if (cfg.token) h.Authorization = "Bearer " + cfg.token;
  let url = ghFileUrl(path);
  if (method === "GET") url += "?ref=" + encodeURIComponent(branch) + "&_=" + Date.now();
  else h["Content-Type"] = "application/json";
  return fetch(url, { method, headers: h, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
}

export function ghFetch(method, body) {
  return ghFile(cfg.path, method, body, cfg.branch);
}

/* Zapis zmiany planu: walidacja, zapis lokalny, odroczone wysłanie na GitHuba (zablokowane w trybie dev) */
export function commit(p) {
  const v = validatePlan(p);
  if (!v.ok) throw new Error(v.error);
  const np = v.plan;
  np.rev = Date.now();
  cache.plan = np;
  cache.dirty = !devMode;
  persist();
  hooks.changed();
  schedulePush();
  return np;
}

export function schedulePush() {
  clearTimeout(pushTimer);
  if (devMode || !cfg.token || conflict) {
    hooks.sync();
    return;
  }
  hooks.sync();
  pushTimer = setTimeout(push, 1200);
}

export async function pull() {
  if (devMode) {
    setSync("dev");
    return;
  }
  if (!cfg.token) {
    setSync("local");
    return;
  }
  if (pulling) return;
  pulling = true;
  setSync("pulling");
  try {
    let res;
    try {
      res = await ghFetch("GET");
    } catch (e) {
      setSync("offline");
      return;
    }
    if (res.status === 404) {
      cache.sha = null;
      cache.dirty = true;
      persist();
      setSync("idle");
      return;
    }
    if (res.status === 401) { setSync("error", "Token jest nieprawidłowy lub wygasł."); return; }
    if (res.status === 403 || res.status === 429) {
      setSync("error", "GitHub odmówił dostępu (limit zapytań albo brak uprawnień).");
      return;
    }
    if (!res.ok) { setSync("error", "GitHub zwrócił błąd " + res.status + "."); return; }
    const j = await res.json();
    let raw;
    try {
      raw = JSON.parse(b64d(j.content || ""));
    } catch (e) {
      setSync("error", "Plik " + cfg.path + " na GitHubie nie jest poprawnym JSON-em.");
      return;
    }
    const v = validatePlan(raw);
    if (!v.ok) {
      setSync("error", "Plik " + cfg.path + " na GitHubie jest nieprawidłowy: " + v.error);
      return;
    }
    const remote = { plan: v.plan, sha: j.sha };
    if (remote.sha === cache.sha) { setSync("ok"); return; }
    if (JSON.stringify(remote.plan) === JSON.stringify(cache.plan)) {
      cache.sha = remote.sha;
      cache.dirty = false;
      persist();
      setSync("ok");
      return;
    }
    if (!cache.dirty) {
      cache.plan = remote.plan;
      cache.sha = remote.sha;
      persist();
      hooks.changed();
      setSync("ok");
      return;
    }
    /* To urządzenie nigdy nie pobrało tego pliku (brak znanej wersji, np. nowa przeglądarka albo świeżo podany token):
       jego lokalny plan nie jest „zmianą względem GitHuba”, więc nie wolno nim nadpisać danych. Wygrywa GitHub, lokalne dane trafiają do kopii. */
    if (!cache.sha) {
      const prev = cache.plan;
      cache.plan = remote.plan;
      cache.sha = remote.sha;
      cache.dirty = false;
      persist();
      hooks.changed();
      setSync("ok");
      hooks.adopted(prev);
      return;
    }
    conflict = remote;
    setSync("conflict");
    hooks.conflict();
  } finally {
    pulling = false;
  }
}

export async function push() {
  clearTimeout(pushTimer);
  if (devMode || !cfg.token || conflict) return;
  if (pushing) { pushAgain = true; return; }
  if (!cache.dirty) return;
  pushing = true;
  setSync("pushing");
  try {
    const snap = cache.plan;
    const body = { message: "Aktualizacja planu zajęć", content: b64e(serialize(snap)), branch: cfg.branch };
    if (cache.sha) body.sha = cache.sha;
    let res;
    try {
      res = await ghFetch("PUT", body);
    } catch (e) {
      setSync("offline");
      return;
    }
    if (res.ok) {
      const j = await res.json();
      cache.sha = j.content && j.content.sha ? j.content.sha : cache.sha;
      if (cache.plan === snap) cache.dirty = false;
      persist();
      setSync("ok");
    } else if (res.status === 409 || res.status === 422) {
      pulling = false;
      await pull();
      if (!conflict && sync.state !== "error" && cache.dirty) {
        setSync("error", "Nie udało się zapisać zmian (kod " + res.status + ").");
      }
    } else if (res.status === 401) {
      setSync("error", "Token jest nieprawidłowy lub wygasł.");
    } else if (res.status === 403) {
      setSync("error", "Token nie ma uprawnienia do zapisu w tym repozytorium (Contents: Read and write).");
    } else if (res.status === 404) {
      setSync("error", "Nie znaleziono repozytorium albo token nie ma do niego dostępu.");
    } else {
      setSync("error", "GitHub zwrócił błąd " + res.status + ".");
    }
  } finally {
    pushing = false;
    if (pushAgain) {
      pushAgain = false;
      push();
    }
  }
}

export async function syncAll() {
  await pull();
  if (cache.dirty && cfg.token && !conflict && sync.state !== "error" && sync.state !== "offline") {
    await push();
  }
}

export function resolveConflict(choice) {
  if (!conflict) return;
  if (choice === "remote") {
    cache.plan = conflict.plan;
    cache.sha = conflict.sha;
    cache.dirty = false;
    persist();
    conflict = null;
    hooks.changed();
    setSync("ok");
  } else if (choice === "local") {
    cache.sha = conflict.sha;
    conflict = null;
    persist();
    push();
  }
}

export async function testToken(c) {
  try {
    const res = await fetch(
      "https://api.github.com/repos/" + encodeURIComponent(c.owner) + "/" + encodeURIComponent(c.repo),
      { headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + c.token }, cache: "no-store" }
    );
    if (res.status === 401) return { ok: false, msg: "Token jest nieprawidłowy lub wygasł." };
    if (res.status === 404) return { ok: false, msg: "Nie znaleziono repozytorium albo token nie ma do niego dostępu." };
    if (!res.ok) return { ok: false, msg: "GitHub zwrócił błąd " + res.status + "." };
    return {
      ok: true,
      msg: "Token jest prawidłowy i ma dostęp do repozytorium. Uprawnienie do zapisu potwierdzi się przy pierwszym zapisie.",
    };
  } catch (e) {
    return { ok: false, msg: "Brak połączenia z GitHubem." };
  }
}
