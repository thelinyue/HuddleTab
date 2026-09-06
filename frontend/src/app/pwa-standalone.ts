type StandaloneNavigator = Navigator & { standalone?: boolean };

/**
 * iOS Safari 使用 navigator.standalone，其他现代浏览器使用 display-mode。
 * 统一映射到根节点类名后，样式和自动化测试不再依赖单一浏览器实现。
 */
export function isPwaStandalone(
  currentNavigator: StandaloneNavigator = navigator as StandaloneNavigator,
  displayMode: MediaQueryList = window.matchMedia("(display-mode: standalone)"),
): boolean {
  return currentNavigator.standalone === true || displayMode.matches;
}

export function installPwaStandaloneState(
  root: HTMLElement = document.documentElement,
  currentNavigator: StandaloneNavigator = navigator as StandaloneNavigator,
  displayMode: MediaQueryList = window.matchMedia("(display-mode: standalone)"),
): () => void {
  const update = () => root.classList.toggle("pwa-standalone", isPwaStandalone(currentNavigator, displayMode));
  update();
  displayMode.addEventListener?.("change", update);
  return () => displayMode.removeEventListener?.("change", update);
}
