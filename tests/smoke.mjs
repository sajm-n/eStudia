// Test dymny UI w headless Chromium (bez zewnętrznych zależności — natywne HTTP + WebSocket CDP).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

function findChrome() {
  for (const bin of [process.env.CHROME_BIN, "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "chromium", "google-chrome"]) {
    if (!bin) continue;
    try {
      const p = bin.startsWith("/") ? (fs.existsSync(bin) ? bin : "") : execFileSync("which", [bin], { encoding: "utf8" }).trim();
      if (p) return p;
    } catch {}
  }
  throw new Error("Nie znaleziono przeglądarki Chromium / Google Chrome.");
}

const chromeBin = findChrome();

const srv = http.createServer((req, res) => {
  const u = (req.url || "/").split("?")[0];
  const f = path.join(ROOT, u === "/" ? "index.html" : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});

await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const port = srv.address().port;

const ch = spawn(
  chromeBin,
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--remote-debugging-port=0",
    "--window-size=1280,860",
    `http://127.0.0.1:${port}/`,
  ],
  { stdio: ["ignore", "pipe", "pipe"] }
);

try {
  const browserWs = await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("Przekroczono czas uruchomienia Chromium.")), 15000);
    ch.stderr.on("data", (d) => {
      const m = d.toString().match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) {
        clearTimeout(t);
        res(m[1]);
      }
    });
  });

  const list = await (await fetch(browserWs.replace("ws://", "http://").replace(/\/devtools\/.*/, "/json/list"))).json();
  const page = list.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));

  let id = 0;
  const errors = [];
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const cid = ++id;
      const fn = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.id === cid) {
          ws.removeEventListener("message", fn);
          msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
        }
      };
      ws.addEventListener("message", fn);
      ws.send(JSON.stringify({ id: cid, method, params }));
    });

  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (msg.method === "Runtime.exceptionThrown") {
      errors.push(msg.params.exceptionDetails.text || "Runtime exception");
    }
  });

  await send("Runtime.enable");
  await new Promise((r) => setTimeout(r, 900));

  const evalJs = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };

  // 1. Desktop: plan, zakładka Zadania, widok Sesja / Kolokwia, Ustawienia (poranny skrót), Przedmioty (+ Dodaj zadanie)
  const desk = await evalJs(`(async () => {
    const hasGrid = !!document.querySelector(".wg");
    document.getElementById("nv-tasks").click();
    await new Promise(r => setTimeout(r, 120));
    const hasExBtn = !!document.getElementById("exBtn");
    document.getElementById("exBtn").click();
    await new Promise(r => setTimeout(r, 120));
    const exTitle = document.getElementById("shT").textContent;
    document.querySelector("[data-sh=close]").click();
    await new Promise(r => setTimeout(r, 100));

    document.getElementById("nv-subj").click();
    await new Promise(r => setTimeout(r, 120));
    const firstSubj = document.querySelector("#sbList [data-a^='sj:']");
    let hasSubjAdd = false;
    if (firstSubj) {
      firstSubj.click();
      await new Promise(r => setTimeout(r, 120));
      const tTab = document.querySelector("[data-sh='stab:tasks']");
      if (tTab) {
        tTab.click();
        await new Promise(r => setTimeout(r, 100));
        hasSubjAdd = !!document.querySelector("[data-sh='sjadd']");
      }
      document.querySelector("[data-sh=close]").click();
      await new Promise(r => setTimeout(r, 100));
    }

    document.querySelector("[data-a='set:']").click();
    await new Promise(r => setTimeout(r, 120));
    const hasMorningOpt = !!document.querySelector("input[name='morningOn']");
    const hasDevOn = !!document.querySelector("[data-sh='devon']");

    // 1b. Tryb deweloperski (playground): włącz, wczytaj testowy JSON, sprawdź izolację i wyjdź
    const realBefore = localStorage.getItem("plan.cache.v1");
    document.querySelector("[data-sh='devon']").click();
    await new Promise(r => setTimeout(r, 120));
    const devBarShown = !document.getElementById("devBar").hidden;

    const testPlan = {
      v: 1,
      rev: 1,
      start: "2026-10-05",
      startWeek: "B",
      classes: [{ id: "dev1", name: "Testowy przedmiot XYZ", type: "l", wd: 0, weeks: "all", s: "10:00", e: "11:30", room: "DEV-1", person: "" }],
      exceptions: [],
      subjects: [],
      tasks: [],
    };
    const dt = new DataTransfer();
    dt.items.add(new File([JSON.stringify(testPlan)], "test-plan.json", { type: "application/json" }));
    const inp = document.getElementById("devImpf");
    inp.files = dt.files;
    inp.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 180));
    const devPlanLoaded = (localStorage.getItem("estudia.dev.plan.v1") || "").includes("Testowy przedmiot XYZ");
    const realUntouched = localStorage.getItem("plan.cache.v1") === realBefore;

    document.querySelector("[data-a='devexit:']").click();
    await new Promise(r => setTimeout(r, 120));
    const devExited = document.getElementById("devBar").hidden && localStorage.getItem("estudia.dev.v1") === null;

    document.getElementById("nv-plan").click();
    await new Promise(r => setTimeout(r, 120));
    document.getElementById("ed").click();
    await new Promise(r => setTimeout(r, 120));
    const dmBtn = document.querySelector(".wg-d[data-a^='daymove:']");
    let dayMoveOpens = false;
    if (dmBtn) {
      dmBtn.click();
      await new Promise(r => setTimeout(r, 120));
      dayMoveOpens = document.getElementById("shT").textContent === "Przenieś lub zamień dzień";
      document.querySelector("[data-sh=close]").click();
      await new Promise(r => setTimeout(r, 100));
    }
    document.getElementById("ed").click();
    return { hasGrid, hasExBtn, exTitle, hasSubjAdd, hasMorningOpt, hasDevOn, devBarShown, devPlanLoaded, realUntouched, devExited, dayMoveOpens };
  })()`);

  // 2. Mobile viewport: kalendarz #cal i render planu bez błędów
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await new Promise((r) => setTimeout(r, 250));
  const mob = await evalJs(`(() => {
    const calBtns = document.querySelectorAll("#cal .cg button").length;
    return { calBtns };
  })()`);

  ws.close();

  if (
    !desk.hasGrid ||
    !desk.hasExBtn ||
    desk.exTitle !== "Sesja / Kolokwia" ||
    !desk.hasSubjAdd ||
    !desk.hasMorningOpt ||
    !desk.hasDevOn ||
    !desk.devBarShown ||
    !desk.devPlanLoaded ||
    !desk.realUntouched ||
    !desk.devExited ||
    !desk.dayMoveOpens ||
    mob.calBtns < 7
  ) {
    throw new Error("Niepowodzenie testu dymnego: " + JSON.stringify({ desk, mob }));
  }
  if (errors.length) {
    throw new Error("Błędy JS w przeglądarce: " + JSON.stringify(errors));
  }
  console.log("Test dymny Chromium OK:", JSON.stringify({ desk, mob }));
} finally {
  ch.kill();
  srv.close();
}
