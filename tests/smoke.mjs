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
    const hasSesAdd = !!document.querySelector("[data-sh='sesadd']");
    const hasExDone = !!document.querySelector("[data-sh^='exdone:']");
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

    // 1c. v3.0.0 Desktop: podgląd miejsca dodania pod kursorem i dodanie zajęć kliknięciem w siatkę
    const col3 = document.querySelectorAll("#list .wg-c[data-date]")[2]; // środa
    let hoverPreviewShown = false;
    let hoverPreviewTime = "";
    let gridClickForm = null;
    if (col3) {
      const r = col3.getBoundingClientRect();
      const targetX = r.left + r.width / 2;
      const targetY = r.top + 52 * 2 + 4; // 10:00 (lo=8:00, WG_H=52)
      col3.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: targetX, clientY: targetY, pointerType: "mouse" }));
      const prev = col3.querySelector(".wb-drop.wb-add");
      hoverPreviewShown = !!prev;
      hoverPreviewTime = prev ? (prev.querySelector("b") || {}).textContent || "" : "";

      col3.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: targetX, clientY: targetY, button: 0 }));
      await new Promise(r => setTimeout(r, 120));
      const f = document.getElementById("f");
      if (f) {
        gridClickForm = {
          title: document.getElementById("shT").textContent,
          wd: f.elements.wd.value,
          date: f.elements.date.value,
          s: f.elements.s.value,
          e: f.elements.e.value,
          expectedDate: col3.dataset.date,
        };
      }
      document.querySelector("[data-sh=close]").click();
      await new Promise(r => setTimeout(r, 100));
    }

    document.getElementById("ed").click();
    return {
      hasGrid,
      hasExBtn,
      exTitle,
      hasSesAdd,
      hasExDone,
      hasSubjAdd,
      hasMorningOpt,
      hasDevOn,
      devBarShown,
      devPlanLoaded,
      realUntouched,
      devExited,
      dayMoveOpens,
      hoverPreviewShown,
      hoverPreviewTime,
      gridClickForm,
    };
  })()`);

  // 2. Mobile viewport: ograniczone Ustawienia (v3.0.0), long-press na kafelku bez kapsułki (v3.0.0) i logika v2.8.5
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await new Promise((r) => setTimeout(r, 250));
  const mob = await evalJs(`(async () => {
    const calBtns = document.querySelectorAll("#cal .cg button").length;

    // 2a. v3.0.0 Mobile Ustawienia: ukryta kopia/import, ukryty tryb dev, sekcja semestr ograniczona do nazwy i archiwizacji zadań
    document.querySelector("[data-a='set:']").click();
    await new Promise((r) => setTimeout(r, 120));
    const mobSet = {
      hasSemPreview: !!document.querySelector(".sem-cur"),
      hasArchTasksBtn: !!document.querySelector("[data-sh='archtasks']"),
      hasSemForm: !!document.getElementById("semF"),
      hasNewSem: !!document.querySelector("[data-sh='newsem']"),
      hasViewArch: !!document.querySelector("[data-sh='viewarch']"),
      hasExport: !!document.querySelector("[data-sh='export']"),
      hasImport: !!document.querySelector("[data-sh='import']"),
      hasReset: !!document.querySelector("[data-sh='reset']"),
      hasDevOn: !!document.querySelector("[data-sh='devon']"),
      hasDevLoad: !!document.querySelector("[data-sh='devload']"),
      versionOk: (document.getElementById("shBody").textContent || "").includes("3.0.0"),
    };
    document.querySelector("[data-sh=close]").click();
    await new Promise((r) => setTimeout(r, 120));

    const now = new Date();
    const tmr = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const pad = (n) => String(n).padStart(2, "0");
    const tmrKey = tmr.getFullYear() + "-" + pad(tmr.getMonth() + 1) + "-" + pad(tmr.getDate());
    const tmrWd = (tmr.getDay() + 6) % 7;

    const loadDev = async (plan) => {
      const dt = new DataTransfer();
      dt.items.add(new File([JSON.stringify(plan)], "v285.json", { type: "application/json" }));
      const inp = document.getElementById("devImpf");
      inp.files = dt.files;
      inp.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 150));
      let dayBtn = document.querySelector("#cal [data-day='" + tmrKey + "']");
      if (!dayBtn) {
        const nextWk = document.querySelector("#cal [data-a='wk:1']");
        if (nextWk) {
          nextWk.click();
          await new Promise((r) => setTimeout(r, 120));
          dayBtn = document.querySelector("#cal [data-day='" + tmrKey + "']");
        }
      }
      if (dayBtn) {
        dayBtn.click();
        await new Promise((r) => setTimeout(r, 120));
      }
    };

    // Scenariusz A: samo kolokwium z aktywnym alertem -> górny alert widoczny, dolna pigułka ukryta, karta bez „Do zrobienia”
    await loadDev({
      v: 1,
      rev: 1,
      start: "2026-10-05",
      startWeek: "B",
      classes: [
        { id: "c1", name: "Wprowadzenie do informatyki technicznej", type: "l", wd: tmrWd, weeks: "all", s: "11:30", e: "13:00", room: "R515", person: "" },
      ],
      exceptions: [],
      subjects: [],
      tasks: [
        { id: "ex1", cat: "exam", text: "Kolokwium 1", cid: "c1", date: tmrKey, due: tmrKey, time: "11:30", rem: { m: "rel", min: 2880 }, done: false },
      ],
    });
    const alertExamShown = !!document.querySelector("#alerts .al.exam");
    const aheadExamHiddenWhenAlert = !document.querySelector("#ahead .ah.exam");
    const cardOnlyExamHasExam = !!document.querySelector("#list .c .ev.exam");
    const cardOnlyExamNoTodo = !document.querySelector("#list .c .ev.tk");

    // 2b. v3.0.0 Mobile Drag & Drop: brak kapsułki .c-drag, long-press bezpośrednio na kafelku .c
    document.getElementById("ed").click();
    await new Promise((r) => setTimeout(r, 120));
    const hasCapsuleHandle = !!document.querySelector("#list .c-drag");
    const card = document.querySelector("#list .c[data-cid='c1']");
    let mobLongPressDragStarted = false;
    let mobLongPressDropOpened = false;
    if (card) {
      const cr = card.getBoundingClientRect();
      const cx = cr.left + cr.width / 2;
      const cy = cr.top + cr.height / 2;
      card.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, button: 0, isPrimary: true, pointerType: "mouse", clientX: cx, clientY: cy }));
      await new Promise((r) => setTimeout(r, 320));
      mobLongPressDragStarted = document.body.classList.contains("mob-dragging") && !!document.querySelector(".drag-card-ghost");
      document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, isPrimary: true, pointerType: "mouse", clientX: cx, clientY: cy + 48 }));
      document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, isPrimary: true, pointerType: "mouse", clientX: cx, clientY: cy + 48 }));
      await new Promise((r) => setTimeout(r, 120));
      mobLongPressDropOpened = !!document.getElementById("drgOnce");
      if (document.querySelector("[data-sh=close]")) {
        document.querySelector("[data-sh=close]").click();
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    document.getElementById("ed").click();
    await new Promise((r) => setTimeout(r, 100));

    // Scenariusz B: kolokwium (bez aktywnego alertu) + sprawozdanie -> dolna pigułka widoczna, karta ma „Kolokwium” i „Do zrobienia: 1”
    await loadDev({
      v: 1,
      rev: 2,
      start: "2026-10-05",
      startWeek: "B",
      classes: [
        { id: "c1", name: "Wprowadzenie do informatyki technicznej", type: "l", wd: tmrWd, weeks: "all", s: "11:30", e: "13:00", room: "R515", person: "" },
      ],
      exceptions: [],
      subjects: [],
      tasks: [
        { id: "ex2", cat: "exam", text: "Kolokwium 2", cid: "c1", date: tmrKey, due: tmrKey, time: "11:30", rem: { m: "rel", min: 1 }, done: false },
        { id: "rp1", cat: "report", text: "Sprawozdanie 1", cid: "c1", date: tmrKey, due: tmrKey, time: "11:30", rem: { m: "rel", min: 1 }, done: false },
      ],
    });
    const aheadExamShownWithoutAlert = !!document.querySelector("#ahead .ah.exam");
    const cardWithReportTodoText = (document.querySelector("#list .c .ev.tk") || {}).textContent || "";

    document.querySelector("[data-a='devexit:']").click();
    await new Promise((r) => setTimeout(r, 100));

    return {
      calBtns,
      mobSet,
      hasCapsuleHandle,
      mobLongPressDragStarted,
      mobLongPressDropOpened,
      alertExamShown,
      aheadExamHiddenWhenAlert,
      cardOnlyExamHasExam,
      cardOnlyExamNoTodo,
      aheadExamShownWithoutAlert,
      cardWithReportTodoText,
    };
  })()`);

  ws.close();

  if (
    !desk.hasGrid ||
    !desk.hasExBtn ||
    !desk.hasSesAdd ||
    desk.hasExDone ||
    desk.exTitle !== "Sesja / Kolokwia" ||
    !desk.hasSubjAdd ||
    !desk.hasMorningOpt ||
    !desk.hasDevOn ||
    !desk.devBarShown ||
    !desk.devPlanLoaded ||
    !desk.realUntouched ||
    !desk.devExited ||
    !desk.dayMoveOpens ||
    !desk.hoverPreviewShown ||
    desk.hoverPreviewTime !== "10:00–11:30" ||
    !desk.gridClickForm ||
    desk.gridClickForm.title !== "Nowe zajęcia" ||
    desk.gridClickForm.wd !== "2" ||
    desk.gridClickForm.date !== desk.gridClickForm.expectedDate ||
    desk.gridClickForm.s !== "10:00" ||
    desk.gridClickForm.e !== "11:30" ||
    mob.calBtns < 7 ||
    !mob.mobSet.hasSemPreview ||
    !mob.mobSet.hasArchTasksBtn ||
    mob.mobSet.hasSemForm ||
    mob.mobSet.hasNewSem ||
    mob.mobSet.hasViewArch ||
    mob.mobSet.hasExport ||
    mob.mobSet.hasImport ||
    mob.mobSet.hasReset ||
    mob.mobSet.hasDevOn ||
    mob.mobSet.hasDevLoad ||
    !mob.mobSet.versionOk ||
    mob.hasCapsuleHandle ||
    !mob.mobLongPressDragStarted ||
    !mob.mobLongPressDropOpened ||
    !mob.alertExamShown ||
    !mob.aheadExamHiddenWhenAlert ||
    !mob.cardOnlyExamHasExam ||
    !mob.cardOnlyExamNoTodo ||
    !mob.aheadExamShownWithoutAlert ||
    mob.cardWithReportTodoText !== "Do zrobienia: 1"
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
