/* ===== Arkusze (bottom sheet / desktop drawer), toasty, potwierdzenia, zmiana planu ===== */

import { clone } from "../core.js";
import { cache, commit } from "../sync.js";
import { $, esc, reduced, ui, app } from "../state.js";

let shTok = 0;
let askRes = null;
let toastT = 0;
let goT = 0;

export function openSheet(title, html, focusSel) {
  if (ui.mcalOpen) {
    ui.mcalOpen = false;
    $("mini").hidden = true;
  }
  const bg = $("shbg");
  app.flushSave();
  if (askRes) {
    const r = askRes;
    askRes = null;
    r(false);
  }
  $("sheet").classList.remove("sj");
  $("sheet").style.minHeight = "";
  $("shT").textContent = title;
  $("shBody").innerHTML = html;
  if (!ui.shOpen) {
    shTok++;
    ui.shOpen = { restore: document.activeElement };
    bg.hidden = false;
    document.body.classList.add("lock");
    void bg.offsetWidth;
    bg.classList.add("open");
  }
  $("sheet").scrollTop = 0;
  const f = focusSel ? $("shBody").querySelector(focusSel) : null;
  setTimeout(() => {
    (f || $("sheet")).focus({ preventScroll: true });
  }, 40);
}

export function closeSheet() {
  if (!ui.shOpen) return;
  app.flushSave();
  if (askRes) {
    const r = askRes;
    askRes = null;
    r(false);
  }
  const bg = $("shbg");
  const s = ui.shOpen;
  ui.shOpen = null;
  const t = ++shTok;
  bg.classList.remove("open");
  const fin = () => {
    if (t !== shTok || ui.shOpen) return;
    bg.hidden = true;
    $("shBody").innerHTML = "";
    document.body.classList.remove("lock");
    try {
      if (s.restore && s.restore.isConnected && s.restore.focus) {
        s.restore.focus({ preventScroll: true });
      }
    } catch (e) {}
  };
  if (reduced()) fin();
  else setTimeout(fin, 230);
}

export function hideToast() {
  const t = $("toast");
  t.classList.remove("on");
  setTimeout(() => {
    if (!t.classList.contains("on")) t.hidden = true;
  }, 220);
}

export function toast(msg, actLabel, act) {
  const t = $("toast");
  t.innerHTML =
    "<span>" +
    esc(msg) +
    "</span>" +
    (actLabel ? '<button type="button" id="toastAct">' + esc(actLabel) + "</button>" : "");
  t.hidden = false;
  void t.offsetWidth;
  t.classList.add("on");
  if (actLabel) {
    $("toastAct").onclick = () => {
      hideToast();
      act();
    };
  }
  clearTimeout(toastT);
  toastT = setTimeout(hideToast, actLabel ? 3000 : 3500);
}

export function ask(msg, okLabel) {
  return new Promise((res) => {
    openSheet(
      "Potwierdź",
      '<p class="shsub">' +
        esc(msg) +
        '</p><div class="acts"><button type="button" class="btn dng" data-sh="yes">' +
        esc(okLabel) +
        '</button><button type="button" class="btn" data-sh="no">Anuluj</button></div>'
    );
    askRes = res;
  });
}

export function resolveAsk(val) {
  const r = askRes;
  askRes = null;
  if (r) r(val);
}

export function change(fn, msg) {
  const before = cache.plan;
  const p = clone(before);
  try {
    fn(p);
    commit(p);
  } catch (e) {
    toast("Nie udało się zapisać zmiany: " + e.message);
    return false;
  }
  if (msg) {
    toast(msg, "Cofnij", () => {
      try { commit(before); } catch (e) {}
    });
  }
  return true;
}

/* Animacja wejścia kart: wywoływana tylko po działaniu użytkownika (nie przy odświeżaniu co minutę) */
export function playGo() {
  if (reduced()) return;
  const b = document.body;
  b.classList.remove("go");
  let k = 0;
  document
    .querySelectorAll(".view:not([hidden]) :is(.c,.wb,.gp,.sbi,.tk-row,.free,.olcard,.hh)")
    .forEach((el) => el.style.setProperty("--k", Math.min(k++, 9)));
  void b.offsetWidth;
  b.classList.add("go");
  clearTimeout(goT);
  goT = setTimeout(() => b.classList.remove("go"), 1100);
}

/* Sprężyste „stuknięcie” w znacznik ukończenia zadania */
export function popCb(id) {
  if (reduced()) return;
  document
    .querySelectorAll(
      '.tk-cb[data-a="tg:' + id + '"] i,.tk-cb[data-sh="tg:' + id + '"] i,.tk-cb[data-sh="stg:' + id + '"] i'
    )
    .forEach((i) => {
      if (i.animate) {
        i.animate(
          [{ transform: "scale(.55)" }, { transform: "scale(1.25)", offset: 0.6 }, { transform: "scale(1)" }],
          { duration: 340, easing: "ease-out" }
        );
      }
    });
}
