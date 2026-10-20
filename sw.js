/* build: d6477daa59cf7f32 */
/* Service worker: офлайн-кэш прогулки.
   Страница и данные (html, js) — сначала из сети, чтобы изменения на сайте были видны сразу;
   без сети — из кэша. Шрифты, картинки и аудио — сначала из кэша.
   Строку build выше сборка заменяет на отпечаток файлов: так браузер замечает любое обновление. */
importScripts("stories.js", "tour-data.js");

var CACHE = "kolmogorov-walk-" + self.TOUR.version;
var FRESH = /(?:\/|\.html|\.js|\.webmanifest|\.json)$/;
var TIMEOUT = 4000;
/* Версии до 2026-10-20-3 брали страницу только из кэша и сами не обновлялись. */
var LEGACY = ["kolmogorov-walk-2026-10-20-1", "kolmogorov-walk-2026-10-20-2", "kolmogorov-walk-2026-10-20-3"];

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
    var old = keys.filter(function (k) { return k.indexOf("kolmogorov-walk-") === 0 && k !== CACHE; });
    var legacy = old.some(function (k) { return LEGACY.indexOf(k) !== -1; });
    await Promise.all(old.map(function (k) { return caches.delete(k); }));
    await self.clients.claim();
    // Открытые вкладки старой версии сами не обновятся — перезагружаем их один раз.
    // Новые версии страницы перезагружаются сами (см. registerSW в index.html).
    if (legacy) {
      var wins = await self.clients.matchAll({ type: "window" });
      wins.forEach(function (c) { try { c.navigate(c.url); } catch (e) {} });
    }
  })());
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.headers.has("range")) { event.respondWith(fromCacheRange(req)); return; }
  var fresh = req.mode === "navigate" || FRESH.test(url.pathname);
  event.respondWith(fresh ? networkFirst(req) : cacheFirst(req));
});

async function fallback(cache, req) {
  var hit = await cache.match(req, { ignoreSearch: true });
  if (!hit && req.mode === "navigate") hit = await cache.match("index.html") || await cache.match("./");
  return hit;
}

function offlineResponse() {
  return new Response("Нет сети, а этот файл ещё не сохранён для офлайна.", {
    status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" }
  });
}

async function networkFirst(req) {
  var cache = await caches.open(CACHE);
  var net = fetch(req.mode === "navigate" ? req.url : req, { cache: "no-cache", credentials: "same-origin" })
    .then(function (res) {
      if (res && res.ok && res.type === "basic") cache.put(req, res.clone());
      return res;
    });
  var timer;
  var timeout = new Promise(function (_, reject) { timer = setTimeout(function () { reject(new Error("timeout")); }, TIMEOUT); });
  try {
    var res = await Promise.race([net, timeout]);
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    var hit = await fallback(cache, req);
    if (hit) return hit;
    try { return await net; } catch (e2) { return offlineResponse(); }
  }
}

async function cacheFirst(req) {
  var cache = await caches.open(CACHE);
  var hit = await fallback(cache, req);
  if (hit) return hit;
  try {
    var res = await fetch(req);
    if (res && res.ok && res.type === "basic") cache.put(req, res.clone());
    return res;
  } catch (e) {
    return offlineResponse();
  }
}

/* Плееры (особенно Safari) просят аудио кусками: отвечаем 206 из кэша. */
async function fromCacheRange(req) {
  var cache = await caches.open(CACHE);
  var hit = await cache.match(req, { ignoreSearch: true });
  if (!hit) { try { return await fetch(req); } catch (e) { return offlineResponse(); } }
  var buf = await hit.arrayBuffer();
  var size = buf.byteLength;
  var m = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") || "");
  var start = m && m[1] ? parseInt(m[1], 10) : 0;
  var end = m && m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
  if (m && !m[1] && m[2]) { start = Math.max(0, size - parseInt(m[2], 10)); end = size - 1; }
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + size } });
  }
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      "Content-Type": hit.headers.get("Content-Type") || "application/octet-stream",
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
