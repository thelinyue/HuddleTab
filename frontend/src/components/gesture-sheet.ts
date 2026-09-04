import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

type SheetDragOptions = {
  open: boolean;
  onClose: () => void;
};

type SheetDragResult = {
  sheetRef: RefObject<HTMLElement | null>;
  headerProps: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  };
  style: CSSProperties;
};

/** Apple 风格 Sheet 手势的可测试物理函数，集中处理边界阻尼和释放投影。 */
export function rubberbandOffset(distance: number, dimension: number, constant = 0.55): number {
  const safeDimension = Math.max(dimension, 1);
  return (distance * safeDimension * constant) / (safeDimension + constant * Math.abs(distance));
}

export function projectSheetOffset(offset: number, velocity: number): number {
  // 180ms 的短投影区分慢拖回弹和快速甩动，不依赖设备帧率。
  return offset + velocity * 0.18;
}

let openSheetCount = 0;
let previousBodyOverflow: string | undefined;

/**
 * 移动端 Sheet 的轻量物理手势：标题栏起手、10px 方向迟滞、Pointer Capture 和
 * 释放速度投影都在这里完成。内容滚动不会抢走下拉手势，回弹使用当前展示位置开始，
 * 因此中途反向拖动不会出现跳变；桌面端同样保留可访问的显式关闭按钮和 Escape。
 */
export function useSheetDrag({ open, onClose }: SheetDragOptions): SheetDragResult {
  const sheetRef = useRef<HTMLElement | null>(null);
  const pointer = useRef<{ id: number; startY: number; lastY: number; lastTime: number; velocity: number; locked: boolean } | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);
  const offsetRef = useRef(0);
  const reducedMotion = useRef(false);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  const setOffsetValue = (value: number) => {
    offsetRef.current = value;
    setOffset(value);
  };

  useEffect(() => {
    if (!open) {
      setOffsetValue(0);
      setDragging(false);
      pointer.current = undefined;
      return;
    }
    if (typeof document !== "undefined") {
      if (openSheetCount === 0) previousBodyOverflow = document.body.style.overflow;
      openSheetCount += 1;
      document.body.style.overflow = "hidden";
    }
    return () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      if (typeof document !== "undefined") {
        openSheetCount = Math.max(0, openSheetCount - 1);
        if (openSheetCount === 0 && previousBodyOverflow !== undefined) {
          document.body.style.overflow = previousBodyOverflow;
          previousBodyOverflow = undefined;
        }
      }
    };
  }, [open]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotion.current = media.matches;
    const update = () => { reducedMotion.current = media.matches; };
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  const rubberband = (distance: number) => {
    const dimension = Math.max(sheetRef.current?.getBoundingClientRect().height ?? 640, 1);
    return rubberbandOffset(distance, dimension);
  };

  const settle = (initialVelocity: number) => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    const start = offsetRef.current;
    if (reducedMotion.current || Math.abs(start) < 0.5) {
      setOffsetValue(0);
      return;
    }
    const startedAt = performance.now();
    const duration = 300;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      // 临界阻尼近似：默认回弹不抖动，快速甩动仍继承一小段初速度。
      const eased = 1 - Math.exp(-7 * progress) * (1 + (initialVelocity / 1200) * (1 - progress));
      setOffsetValue(start * (1 - eased));
      if (progress < 1) frame.current = requestAnimationFrame(tick);
      else setOffsetValue(0);
    };
    frame.current = requestAnimationFrame(tick);
  };

  const finish = (event: ReactPointerEvent<HTMLElement>) => {
    const current = pointer.current;
    if (!current || current.id !== event.pointerId) return;
    const element = event.currentTarget;
    if (typeof element.hasPointerCapture === "function" && element.hasPointerCapture(event.pointerId) && typeof element.releasePointerCapture === "function") element.releasePointerCapture(event.pointerId);
    pointer.current = undefined;
    setDragging(false);
    const height = sheetRef.current?.getBoundingClientRect().height ?? window.innerHeight;
    const projected = projectSheetOffset(offsetRef.current, current.velocity);
    if (projected > height * 0.28 || current.velocity > 900) {
      onClose();
      setOffsetValue(0);
      return;
    }
    settle(current.velocity);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    // 标题栏上的返回/关闭等按钮拥有自己的点击语义，不能被拖拽识别器吞掉。
    // 图标按钮的实际 target 可能是 SVGElement；统一按 Element 检查，避免点到图标时
    // 被误识别为拖拽起点并吞掉按钮 click。
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("button, a, input, select, textarea")) return;
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    if (typeof event.currentTarget.setPointerCapture === "function") event.currentTarget.setPointerCapture(event.pointerId);
    pointer.current = { id: event.pointerId, startY: event.clientY, lastY: event.clientY, lastTime: performance.now(), velocity: 0, locked: false };
    setDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const current = pointer.current;
    if (!current || current.id !== event.pointerId) return;
    const now = performance.now();
    const dy = event.clientY - current.startY;
    if (!current.locked && Math.abs(dy) < 10) return;
    current.locked = true;
    const dt = Math.max(1, now - current.lastTime);
    current.velocity = ((event.clientY - current.lastY) / dt) * 1000;
    current.lastY = event.clientY;
    current.lastTime = now;
    setOffsetValue(dy >= 0 ? dy : rubberband(dy));
    event.preventDefault();
  };

  return {
    sheetRef,
    headerProps: { onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: finish },
    style: { transform: `translate3d(0, ${offset}px, 0)`, transition: dragging ? "none" : undefined, willChange: "transform" },
  };
}
