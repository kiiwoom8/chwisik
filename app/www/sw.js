/* Installable page only (not used inside the Android app). Keeps the loader files on the phone so the
   app opens offline; the data itself always comes from the API.
   - Opening the page (navigation, or ./ / index.html): network first, revalidated past the browser's HTTP cache
     (GitHub Pages lets browsers keep files 10 min), so a new loader is used at once. The stored copy only when
     offline, on an error, or when the network takes over 4 s. Stored under one key (the scope), whatever
     ?store= / #move= the address had. (v2 was cache-first: a new loader showed only on the open after next.)
   - Other same-origin files: from the store, refreshed in the background. Everything else goes to the network. */
var CACHE = "chwisik-v3";
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
  if (e.request.mode === "navigate" || path === home || path === home + "index.html") {
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
