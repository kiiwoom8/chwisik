/* Installable page only (not used inside the Android app). Keeps the loader files on the phone so the
   app opens offline; the data itself always comes from the API.
   - Opening the page (./ or index.html, any ?query): network first, revalidated past the browser's HTTP cache
     (GitHub Pages lets browsers keep files 10 min), so a new loader is used at once. The stored copy only when
     offline, on an error, or when the network takes over 4 s. Stored under one key (the scope), whatever
     ?store= / #move= the address had. (v2 was cache-first: a new loader showed only on the open after next.)
   - Other same-origin files: from the store, refreshed in the background. Everything else goes to the network.
   - login.html (Google sign-in) always from the network. (Until v4 every navigation got the page, so it would have
     opened the page instead of login.html.) */
var CACHE = "chwisik-v4";
var FILES = ["./", "page.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
self.addEventListener("install", function (e) { e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); })); self.skipWaiting(); });
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }));
  self.clients.claim();
});
self.addEventListener("fetch", function (e) {
  var u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  var home = self.registration.scope, path = u.origin + u.pathname;
  if (path === home + "login.html") return;
  if (path === home || path === home + "index.html") {
    e.respondWith(caches.open(CACHE).then(function (c) {
      var stored = function () { return c.match(home).then(function (hit) { return hit || Response.error(); }); };
      var net = fetch(home, { cache: "no-cache" }).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        c.put(home, r.clone());
        return r;
      });
      var slow = new Promise(function (ok) { setTimeout(ok, 4000); }).then(function () {
        return c.match(home).then(function (hit) { return hit || net; });
      });
      return Promise.race([net, slow]).catch(stored);
    }));
    return;
  }
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(e.request, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(e.request).then(function (r) { if (r.ok) c.put(e.request, r.clone()); return r; });
      return hit || net;
    });
  }));
});
