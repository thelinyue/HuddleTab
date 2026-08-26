export const foregroundSyncEvent = "huddletab:foreground-sync";

/** 本地写入完成后通知当前页面的唯一前台同步器，不交给 Service Worker 执行业务写入。 */
export function requestForegroundSync() {
  window.dispatchEvent(new Event(foregroundSyncEvent));
}
