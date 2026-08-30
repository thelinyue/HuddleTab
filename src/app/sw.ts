/// <reference lib="webworker" />

import {
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  Serwist,
  type PrecacheEntry,
} from "serwist";

import { isNavigationCacheable } from "@/pwa/service-worker/navigation-cache-boundary";

declare const self: ServiceWorkerGlobalScope & {
  __SW_MANIFEST: Array<PrecacheEntry>;
};

/**
 * Service Worker 只保存可公开复用的 App Shell 与构建静态资源。
 * 所有 /api/ 请求（含认证、活动快照、Mutation 与附件字节）均没有匹配规则，
 * 因此永远不会写入 Cache Storage；账务离线写入仍由前台 IndexedDB 队列独占。
 */
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: false,
  clientsClaim: false,
  runtimeCaching: [
    {
      matcher: ({ request, url }) =>
        request.mode === "navigate" &&
        isNavigationCacheable(url, self.location.origin),
      handler: new NetworkFirst({ cacheName: "huddletab-app-shell-v1" }),
    },
    {
      matcher: ({ url }) =>
        url.origin === self.location.origin &&
        (url.pathname.startsWith("/_next/static/") ||
          url.pathname.startsWith("/icons/")),
      handler: new CacheFirst({
        cacheName: "huddletab-static-v1",
        plugins: [new ExpirationPlugin({ maxEntries: 80 })],
      }),
    },
  ],
});

serwist.addEventListeners();
