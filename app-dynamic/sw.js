// Kinto PWA Service Worker — オフラインでも開けるよう最小キャッシュ
// 方針: HTML はネットワーク優先（デプロイ更新が届く）、静的アセットはキャッシュ優先。
// デプロイで内容を変えたら CACHE の版番号を上げると旧キャッシュが破棄される。
const CACHE = "kinto-neon-v2";
const ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./foods.full.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

function fetchAndCache(req) {
  return fetch(req).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
    }
    return res;
  });
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // ipapi.co 等の外部APIはキャッシュしない（地域判定が固定化するため）
  if (e.request.method !== "GET" || url.origin !== location.origin) return;

  if (e.request.mode === "navigate" || url.pathname.endsWith("/index.html")) {
    e.respondWith(
      fetchAndCache(e.request).catch(() =>
        caches.match(e.request).then((hit) => hit || caches.match("./index.html"))
      )
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetchAndCache(e.request))
  );
});
