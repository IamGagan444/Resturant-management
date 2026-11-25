/* Console service worker: lets kitchen and waiter screens open with no connection.
 *  - /_next/static/* is content-hashed → cache first, forever
 *  - page loads (navigations) → network first, cached copy when offline
 *  - everything else is left to the browser: API calls (other origins), and the router's
 *    /…/index.txt page data. Answering those from here once put that raw data on screen
 *    instead of the page, so the worker never touches them.
 */
const CACHE = "rms-console-v3"; // v2: dropped v1, which held router .txt data; v3: drops pages cached from older deploys
const SHELL = ["/", "/kds/", "/waiter/", "/device/", "/login/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // only whole-page loads; keep cached copies to real HTML pages
  if (req.mode !== "navigate") return;

  // A page load of router data (/kds/index.txt?_rsc=…): Next hard-navigates there when this phone runs an older
  // deploy than the server, which put the raw data on screen and kept it there on every refresh. Go to the page.
  if (url.pathname.endsWith("/index.txt")) {
    const page = new URL(url);
    page.pathname = url.pathname.slice(0, -"index.txt".length);
    page.searchParams.delete("_rsc");
    event.respondWith(Response.redirect(page.href, 302));
    return;
  }
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && !res.redirected && (res.headers.get("content-type") || "").includes("text/html")) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches
          .match(req, { ignoreSearch: true })
          .then((hit) => hit || caches.match("/"))
          .then((hit) => hit || Response.error()),
      ),
  );
});

/* ---------- Phone alerts ---------- */

// A push arrives for something still waiting; the server repeats it until someone acts.
/** True only if a screen answers that it is in front and ringing. A frozen background page never answers, so we ring. */
function handledOnScreen(wins) {
  const ask = (w) =>
    new Promise((resolve) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = (e) => resolve(e.data?.handled === true);
      setTimeout(() => resolve(false), 400);
      w.postMessage({ type: "alert-check" }, [ch.port2]);
    });
  return Promise.all(wins.filter((w) => w.visibilityState === "visible").map((w) => ask(w).catch(() => false))).then((a) => a.some(Boolean));
}

const IOS = /iPhone|iPad|iPod/.test(self.navigator.userAgent) || (/Macintosh/.test(self.navigator.userAgent) && self.navigator.maxTouchPoints > 1);

self.addEventListener("push", (event) => {
  let p = {};
  try {
    p = event.data.json();
  } catch {
    // shown with the defaults below: browsers require a notification for every push
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (wins) => {
      // the open screen is already ringing by itself
      const onScreen = await handledOnScreen(wins);
      // iPhone has no `renotify`: replacing an alert can be quiet, so take the old one away and post a new one
      if (IOS) for (const n of await self.registration.getNotifications().catch(() => [])) n.close();
      return self.registration.showNotification(p.title || "Restro", {
        body: p.body || "Something is waiting for you",
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: IOS ? `rms-alerts-${Date.now()}` : "rms-alerts", // one alert that keeps ringing, not a pile of them
        renotify: true,
        requireInteraction: true,
        silent: onScreen,
        ...(onScreen ? {} : { vibrate: [400, 150, 400, 150, 400, 150, 800] }),
        data: { url: p.url || "/" },
      });
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // only ever our own pages
  const url = new URL(event.notification.data?.url || "/", self.location.origin);
  const target = url.origin === self.location.origin ? url.href : self.location.origin;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const open = wins.find((w) => w.url.startsWith(target)) || wins[0];
      if (!open) return self.clients.openWindow(target);
      return open.focus().then((w) => (w.url.startsWith(target) ? w : w.navigate(target).catch(() => w)));
    }),
  );
});
