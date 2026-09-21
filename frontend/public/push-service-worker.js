/*
 * 这段脚本由 Workbox 生成的主 Service Worker importScripts 引入。
 * 推送事件必须在 Service Worker 中直接展示系统通知，才能覆盖 PWA 未打开的场景。
 */
(() => {
  const fallbackUrl = "/notifications";

  function sameOriginUrl(value) {
    if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return fallbackUrl;
    try {
      const url = new URL(value, self.location.origin);
      if (url.origin !== self.location.origin) return fallbackUrl;
      return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return fallbackUrl;
    }
  }

  function payloadFromEvent(event) {
    if (!event.data) return null;
    try {
      const payload = event.data.json();
      return payload && typeof payload === "object" ? payload : null;
    } catch {
      return null;
    }
  }

  self.addEventListener("push", (event) => {
    const payload = payloadFromEvent(event);
    if (!payload) {
      event.waitUntil(self.registration.showNotification("伙记", {
        body: "你有一条新通知。",
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        tag: "huddletab-notification-fallback",
        data: { url: fallbackUrl, notificationId: "" },
      }));
      return;
    }
    const data = payload.data && typeof payload.data === "object" ? payload.data : {};
    const notificationId = typeof data.notificationId === "string" ? data.notificationId : "";
    const target = new URL(sameOriginUrl(typeof data.url === "string" ? data.url : fallbackUrl), self.location.origin);
    if (notificationId) target.searchParams.set("pushNotification", notificationId);
    const title = typeof payload.title === "string" && payload.title.trim() ? payload.title : "伙记";
    const body = typeof payload.body === "string" ? payload.body : "你有一条新通知。";
    event.waitUntil(self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: notificationId ? `huddletab-notification-${notificationId}` : "huddletab-notification",
      data: { url: `${target.pathname}${target.search}${target.hash}`, notificationId },
    }));
  });

  self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const target = sameOriginUrl(event.notification?.data?.url);
    event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => client.url.startsWith(self.location.origin));
      if (existing) return existing.navigate(target).then((client) => client?.focus());
      return self.clients.openWindow(target);
    }));
  });
})();
