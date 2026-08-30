"use client";

import { useEffect } from "react";

/**
 * 历史组件名保留以避免根布局产生无关改动；现在只注册由 Serwist 构建的 Worker。
 * 页面、认证/API 响应和附件不再由前台手工写入 Cache Storage，账务同步仍在前台队列执行。
 */
export function AppShellCache() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
  }, []);

  return null;
}
