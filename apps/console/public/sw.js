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
