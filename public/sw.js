// Cheap Transfers service worker — app-shell caching + offline fallback
const CACHE = "cheaptransfers-v3";
const PRECACHE = [
  "/offline.html",
  "/icon-192.png",
  "/icon-512.png",
  "/brand/logo.png",
  "/brand/mark.png",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let cross-origin (Supabase, Google) pass through
  if (url.pathname.startsWith("/api/")) return; // never cache API calls

  // Page navigations: network-first, fall back to a friendly offline page
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match("/offline.html").then((r) => r || new Response("Offline", { status: 503 }))
      )
    );
    return;
  }

  // Static assets: cache-first (hashed build files, icons, fonts, styles)
  if (
    url.pathname.startsWith("/_next/static/") ||
    /\.(?:png|svg|ico|woff2?|css|js|json|webmanifest)$/.test(url.pathname)
  ) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        });
      })
    );
  }
});

// ── Driver app: "new job" push notifications ─────────────────────────────────
// Sent by the server when a job is assigned (src/lib/push.ts). They arrive even
// when the driver app is closed; tapping one opens (or focuses) the app.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Cheap Transfers", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "New job", {
      body: data.body || "",
      tag: data.tag,
      renotify: true,
      requireInteraction: true,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      vibrate: [300, 150, 300, 150, 300],
      data: { url: data.url || "/driver" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/driver", self.location.origin);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (new URL(w.url).pathname.startsWith("/driver") && "focus" in w) {
          w.navigate(target.href).catch(() => {});
          return w.focus();
        }
      }
      return self.clients.openWindow(target.href);
    })
  );
});
