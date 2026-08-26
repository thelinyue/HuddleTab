const APP_SHELL_CACHE = "huddletab-app-shell-v1";

// Service Worker 只缓存已访问的页面壳与静态资源；账务 API 和 IndexedDB 队列均由前台应用处理。
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          const cache = await caches.open(APP_SHELL_CACHE);
          await cache.put(request, response.clone());
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          return new Response("应用页面尚未缓存，请联网后重试。", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }),
    );
    return;
  }

  if (
    url.pathname.startsWith("/_next/") ||
    ["script", "style", "font", "image"].includes(request.destination)
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then(async (response) => {
            const cache = await caches.open(APP_SHELL_CACHE);
            await cache.put(request, response.clone());
            return response;
          }),
      ),
    );
  }
});
