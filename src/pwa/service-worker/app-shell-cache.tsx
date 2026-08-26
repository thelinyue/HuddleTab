"use client";

import { useEffect } from "react";

const APP_SHELL_CACHE = "huddletab-app-shell-v1";

/** 业务 API、认证与附件均以 /api/ 为前缀，绝不能由 App Shell 预缓存。 */
export function isAppShellCacheable(url: URL, appOrigin: string) {
  return url.origin === appOrigin && !url.pathname.startsWith("/api/");
}

/**
 * 首次在线访问后缓存当前页面和已加载的同源静态资源，使 Service Worker 可以在
 * 断网刷新时返回可启动的 App Shell。业务 API 不在此处缓存，账务数据仍从 IndexedDB 读取。
 */
export function AppShellCache() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker
      .register("/sw.js")
      .then(async () => {
        await navigator.serviceWorker.ready;
        const cache = await caches.open(APP_SHELL_CACHE);
        const urls = [
          window.location.href,
          ...[...document.scripts].map((script) => script.src).filter(Boolean),
          ...performance
            .getEntriesByType("resource")
            .map((entry) => entry.name)
            .filter((value) =>
              isAppShellCacheable(new URL(value), location.origin),
            ),
        ];
        await Promise.all(
          [...new Set(urls)].map((url) =>
            cache.add(url).catch(() => undefined),
          ),
        );
      })
      .catch(() => undefined);
  }, []);

  return null;
}
