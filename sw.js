/* Service worker: aplikacja działa offline. Sieć ma pierwszeństwo, więc nowe wersje trafiają
   do telefonu przy najbliższym otwarciu z internetem; pamięć podręczna jest tylko zapasem. */
const V = "plan-v39";
const SEEN_CACHE = "estudia-push-seen";
const SEEN_URL = "./__push_seen__";
const SHELL = [
  "./",
  "./index.html",
  "./css/app.css",
  "./js/config.js",
  "./js/core.js",
  "./js/sync.js",
  "./js/push.js",
  "./js/state.js",
  "./js/app.js",
  "./js/ui/sheet.js",
  "./js/ui/plan.js",
  "./js/ui/classDetail.js",
  "./js/ui/dayMove.js",
  "./js/ui/drag.js",
  "./js/ui/tasks.js",
  "./js/ui/subjects.js",
  "./js/ui/settings.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== V && k !== SEEN_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function networkFirst(req) {
  return caches.open(V).then((cache) => {
    const net = fetch(req, { cache: "no-cache" }).then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    });
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 4000));
    return Promise.race([net, timeout]).catch(() =>
      cache
        .match(req, { ignoreSearch: true })
        .then((hit) => hit || (req.mode === "navigate" ? cache.match("./index.html") : null))
        .then((hit) => hit || net)
    );
  });
}

function staleWhileRevalidate(req) {
  return caches.open(V).then((cache) =>
    cache.match(req).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    e.respondWith(networkFirst(req));
  } else if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(staleWhileRevalidate(req));
  }
});

function rememberPushSeen(tag) {
  if (!tag || tag === "test") return Promise.resolve();
  return caches
    .open(SEEN_CACHE)
    .then((c) =>
      c
        .match(SEEN_URL)
        .then((r) => (r ? r.json() : {}))
        .catch(() => ({}))
        .then((o) => {
          const map = o && typeof o === "object" ? o : {};
          const now = Date.now();
          map[tag] = now;
          /* Ogranicz rozmiar mapy do wpisów z ostatnich 90 dni */
          const cutoff = now - 90 * 864e5;
          for (const k of Object.keys(map)) {
            if (typeof map[k] !== "number" || map[k] < cutoff) delete map[k];
          }
          return c.put(SEEN_URL, new Response(JSON.stringify(map), { headers: { "Content-Type": "application/json" } }));
        })
    )
    .catch(() => {});
}

/* Powiadomienie push (wysyłane przez GitHub Actions, także gdy aplikacja jest zamknięta) */
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(
    Promise.all([
      rememberPushSeen(d.tag),
      self.registration.showNotification(d.title || "eStudia", {
        body: d.body || "",
        tag: d.tag || undefined,
        lang: "pl",
        icon: "icon.png",
        badge: "icon.png",
        data: { url: d.url || "./" },
      }),
    ])
  );
});

/* Stuknięcie w powiadomienie otwiera aplikację (lub konkretne zadanie z data.url) */
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const targetUrl = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          if (targetUrl !== "./" && "navigate" in c) {
            return c.navigate(targetUrl).then(() => c.focus()).catch(() => c.focus());
          }
          return c.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
