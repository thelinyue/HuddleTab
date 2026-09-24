import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { RecommendationSelection } from "../accounting/api";

type PageKind = "feed" | "settlement";
type ReadingPosition = { y: number; anchors: Array<{ key: string; top: number }>; focus?: string };

/** 只保存当前账号、当前活动的阅读状态；由工作区的 key 隔离，离开活动即释放。 */
function useActivityViewState() {
  const [strategySelection, setStrategySelection] = useState<RecommendationSelection>({});
  const [balanceOpen, setBalanceOpen] = useState(false);
  const positions = useRef<Partial<Record<PageKind, ReadingPosition>>>({});
  return { strategySelection, setStrategySelection, balanceOpen, setBalanceOpen, positions };
}
const ActivityViewContext = createContext<ReturnType<typeof useActivityViewState> | null>(null);

export function ActivityViewProvider({ children }: { children: ReactNode }) {
  const value = useActivityViewState();
  useEffect(() => {
    const previous = history.scrollRestoration;
    history.scrollRestoration = "manual";
    return () => { history.scrollRestoration = previous; };
  }, []);
  return <ActivityViewContext.Provider value={value}>{children}</ActivityViewContext.Provider>;
}

export function useActivityView() {
  const value = useContext(ActivityViewContext);
  if (!value) throw new Error("活动阅读状态必须在活动工作区中使用。");
  return value;
}

/**
 * 用账单或转账的稳定身份恢复阅读位置，新增、删除记录后仍能找回邻近内容。
 * 路由与面板共用同一套捕获/恢复；恢复焦点不触发浏览器再次滚动。
 */
export function useActivityPagePosition(kind: PageKind, ready: boolean) {
  const { positions } = useActivityView();
  const containerRef = useRef<HTMLDivElement>(null);
  const restoring = useRef(false);
  const firstLayout = useRef(true);
  const frame = useRef(0);
  const capturePosition = useCallback((trigger?: HTMLElement) => {
    if (restoring.current || !containerRef.current?.isConnected) return;
    const rows = [...containerRef.current.querySelectorAll<HTMLElement>("[data-reading-key]")];
    const edge = document.querySelector(".workspace-header")?.getBoundingClientRect().bottom ?? 0;
    const index = rows.findIndex(row => row.getBoundingClientRect().bottom > edge);
    const neighbors = index < 0 ? [] : [rows[index], rows[index + 1], rows[index - 1]].filter(Boolean);
    const focused = trigger ?? document.activeElement?.closest<HTMLElement>("[data-focus-key]");
    positions.current[kind] = {
      y: window.scrollY,
      anchors: neighbors.map(row => ({ key: row.dataset.readingKey!, top: row.getBoundingClientRect().top })),
      focus: focused?.dataset.focusKey ?? positions.current[kind]?.focus,
    };
  }, [kind, positions]);
  const applyPosition = useCallback(() => {
    const saved = positions.current[kind];
    if (!saved) return;
    const rows = [...(containerRef.current?.querySelectorAll<HTMLElement>("[data-reading-key]") ?? [])];
    const anchor = saved?.anchors.find(item => rows.some(row => row.dataset.readingKey === item.key));
    const row = anchor && rows.find(item => item.dataset.readingKey === anchor.key);
    const top = row && anchor ? window.scrollY + row.getBoundingClientRect().top - anchor.top : saved?.y ?? 0;
    window.scrollTo({ top, behavior: "instant" });
    // 推荐已完成或账单被移除时，焦点跟随恢复的邻近记录，便于键盘连续处理。
    const focus = [...document.querySelectorAll<HTMLElement>("[data-focus-key]")].find(item => item.dataset.focusKey === saved?.focus)
      ?? (saved?.focus ? row?.matches("[data-focus-key]") ? row : row?.querySelector<HTMLElement>("[data-focus-key]") : undefined);
    focus?.focus({ preventScroll: true });
  }, [kind, positions]);
  const restorePosition = useCallback(() => {
    restoring.current = true;
    cancelAnimationFrame(frame.current);
    // 等 React 提交以及弹层解除滚动锁定，再按更新后的记录布局定位。
    frame.current = requestAnimationFrame(() => {
      applyPosition();
      frame.current = requestAnimationFrame(() => { applyPosition(); restoring.current = false; });
    });
  }, [applyPosition]);
  useLayoutEffect(() => {
    if (firstLayout.current) { firstLayout.current = false; window.scrollTo({ top: 0, behavior: "instant" }); }
    if (!ready) return;
    // 本地队列可能晚于流水完成加载；没有旧位置时不能把用户已开始的滚动重置到顶部。
    // 首次定位在绘制前同步完成，不能让延迟帧覆盖用户刚开始的滚动。
    applyPosition();
    const remember = (event: Event) => {
      // Safari 点击按钮不会自动聚焦，记录实际操作入口才能在推荐消失后恢复邻近焦点。
      const trigger = event.type === "click" && event.target instanceof Element ? event.target.closest<HTMLElement>("[data-focus-key]") : null;
      if (!document.querySelector('[aria-modal="true"]')) capturePosition(trigger ?? undefined);
    };
    window.addEventListener("scroll", remember, { passive: true });
    window.addEventListener("popstate", remember);
    document.addEventListener("click", remember, true);
    return () => {
      cancelAnimationFrame(frame.current);
      // 卸载阶段页头可能已经移除；此时重测会把 Safari 的页头高度误计为阅读偏移。
      // 导航前的 click/popstate 与滚动监听已保存完整页面的坐标。
      window.removeEventListener("scroll", remember);
      window.removeEventListener("popstate", remember);
      document.removeEventListener("click", remember, true);
    };
  }, [ready, capturePosition, applyPosition]);
  return { containerRef, capturePosition, restorePosition };
}
