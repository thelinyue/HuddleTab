/**
 * 运行时导航缓存的状态边界。根路径、认证、初始化和邀请页面可能反映当前
 * 会话或部署状态，不能被 NetworkFirst 的历史 HTML 响应复用。
 */
const sensitiveNavigationRoots = [
  "/",
  "/login",
  "/register",
  "/setup",
  "/join",
] as const;

function isPathUnderRoot(pathname: string, root: string): boolean {
  return root === "/"
    ? pathname === root
    : pathname === root || pathname.startsWith(`${root}/`);
}

/** 只允许同源、非 API、非状态敏感路径进入运行时导航缓存。 */
export function isNavigationCacheable(url: URL, appOrigin: string): boolean {
  if (url.origin !== appOrigin) return false;
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    return false;
  }
  return !sensitiveNavigationRoots.some((root) =>
    isPathUnderRoot(url.pathname, root),
  );
}
