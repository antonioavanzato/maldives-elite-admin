/* Service worker админки Maldives Elite.
   Стратегия: network-first для HTML (чтобы обновления доезжали сразу),
   cache-first для статики (иконки, манифест). Запросы к API не кэшируются. */

const CACHE = "me-admin-v1";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./images/logo trans.png",
  "./images/icon-192.png",
  "./images/icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;

  if (e.request.mode === "navigate" || url.pathname.endsWith("/index.html")) {
    // HTML: сеть, при офлайне — кэш
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request).then((m) => m || caches.match("./index.html")))
    );
    return;
  }

  // Статика: кэш, при промахе — сеть с докэшированием
  e.respondWith(
    caches.match(e.request).then((m) =>
      m ||
      fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
    )
  );
});

/* Push-уведомления: заготовка под Web Push.
   Полезная нагрузка придёт с бэкенда Яндекса, когда он появится. */
self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) {}
  const title = data.title || "Maldives Elite";
  e.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "Новая заявка",
      icon: "./images/icon-192.png",
      badge: "./images/icon-192.png",
      data: { url: data.url || "./" }
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if ("focus" in c) return c.focus();
      return clients.openWindow(e.notification.data.url || "./");
    })
  );
});
