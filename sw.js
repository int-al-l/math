/* Service worker: офлайн-кэш прогулки.
   Список файлов берётся из tour-data.js; при смене TOUR.version кэш пересобирается. */
importScripts("stories.js", "tour-data.js");

var CACHE = "kolmogorov-walk-" + self.TOUR.version;

self.addEventListener("install", function (event) {
  event.waitUntil((async function () {
    var cache = await caches.open(CACHE);
    // Оболочка обязательна: без неё офлайн не заработает.
    await cache.addAll(self.TOUR.shell.map(function (u) { return new Request(u, { cache: "reload" }); }));
    // Фото и аудио — по возможности; отсутствующий файл не ломает установку.
    await Promise.all(self.TOUR.media().map(function (u) {
      return cache.add(new Request(u, { cache: "reload" })).catch(function () {});
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", function (event) {
  event.waitUntil((async function () {
    var keys = await caches.keys();
    await Promise.all(keys.filter(function (k) {
      return k.indexOf("kolmogorov-walk-") === 0 && k !== CACHE;
    }).map(function (k) { return caches.delete(k); }));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async function () {
    var cache = await caches.open(CACHE);
    var hit = await cache.match(req, { ignoreSearch: true });
    if (!hit && req.mode === "navigate") {
      hit = await cache.match("index.html") || await cache.match("./");
    }
    // Плееры (особенно Safari) просят аудио кусками: отвечаем 206 из кэша.
    if (hit && req.headers.has("range")) return rangeFrom(hit, req.headers.get("range"));
    if (hit) return hit;
    try {
      var res = await fetch(req);
      if (res && res.ok && res.type === "basic" && !req.headers.has("range")) {
        cache.put(req, res.clone());
      }
      return res;
    } catch (e) {
      if (req.mode === "navigate") {
        var shell = await cache.match("index.html");
        if (shell) return shell;
      }
      return new Response("Нет сети, а этот файл ещё не сохранён для офлайна.", {
        status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }
  })());
});

async function rangeFrom(res, header) {
  var buf = await res.arrayBuffer();
  var size = buf.byteLength;
  var m = /bytes=(\d*)-(\d*)/.exec(header || "");
  var start = m && m[1] ? parseInt(m[1], 10) : 0;
  var end = m && m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
  if (m && !m[1] && m[2]) { start = Math.max(0, size - parseInt(m[2], 10)); end = size - 1; }
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + size } });
  }
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      "Content-Type": res.headers.get("Content-Type") || "application/octet-stream",
      "Content-Range": "bytes " + start + "-" + end + "/" + size,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes"
    }
  });
}

self.addEventListener("message", function (event) {
  if (event.data === "version") {
    event.source && event.source.postMessage({ type: "version", cache: CACHE });
  }
});
