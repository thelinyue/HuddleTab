import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

type SheetDragOptions = {
  open: boolean;
  onClose: () => void;
  canClose?: () => boolean;
};

type SheetDragResult = {
  present: boolean;
  sheetRef: RefObject<HTMLElement | null>;
  overlayStyle: CSSProperties;
  requestClose: () => void;
  headerProps: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  };
  style: CSSProperties;
};

type AnimationPhase = "closed" | "opening" | "idle" | "dragging" | "settling" | "closing";

export const SHEET_SPRING = { stiffness: 420, damping: 42, mass: 1 } as const;

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
 * Sheet 以当前展示偏移作为每次抓取的起点，并将释放速度交给同一组弹簧参数。
 * 外部关闭和手势关闭都会先完成可见退场，再释放背景锁定和调用业务 onClose。
 */
export function useSheetDrag({ open, onClose, canClose }: SheetDragOptions): SheetDragResult {
  const sheetRef = useRef<HTMLElement | null>(null);
  const pointer = useRef<{
    id: number;
    startY: number;
    startOffset: number;
    lastY: number;
    lastTime: number;
    velocity: number;
    locked: boolean;
  } | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);
  const phase = useRef<AnimationPhase>("closed");
  const offsetRef = useRef(0);
  const opacityRef = useRef(open ? 0 : 1);
  const animationVelocity = useRef(0);
  const onCloseRef = useRef(onClose);
  const canCloseRef = useRef(canClose);
  const reducedMotion = useRef(
    typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [present, setPresent] = useState(open);
  const [offset, setOffset] = useState(0);
  const [opacity, setOpacity] = useState(open ? 0 : 1);
  const [dragging, setDragging] = useState(false);
  const [overlayStyle, setOverlayStyle] = useState<CSSProperties>({});
  onCloseRef.current = onClose;
  canCloseRef.current = canClose;

  const cancelAnimation = useCallback(() => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
  }, []);

  const setOffsetValue = useCallback((value: number) => {
    offsetRef.current = value;
    setOffset(value);
  }, []);

  const setOpacityValue = useCallback((value: number) => {
    opacityRef.current = value;
    setOpacity(value);
  }, []);

  const animateOpacity = useCallback((target: number, onComplete: () => void) => {
    cancelAnimation();
    const start = opacityRef.current;
    const startedAt = performance.now();
    const duration = 140 * Math.max(Math.abs(target - start), 0.2);
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - (1 - progress) ** 3;
      setOpacityValue(start + (target - start) * eased);
      if (progress < 1) frame.current = requestAnimationFrame(tick);
      else {
        frame.current = undefined;
        setOpacityValue(target);
        onComplete();
      }
    };
    frame.current = requestAnimationFrame(tick);
  }, [cancelAnimation, setOpacityValue]);

  const animateSpring = useCallback((target: number, initialVelocity: number, onComplete: () => void) => {
    cancelAnimation();
    let position = offsetRef.current;
    let velocity = initialVelocity;
    let previousTime = performance.now();
    animationVelocity.current = velocity;
    const tick = (now: number) => {
      const elapsed = Math.min(Math.max(now - previousTime, 1), 32);
      previousTime = now;
      const steps = Math.max(1, Math.ceil(elapsed / 8));
      const delta = elapsed / steps / 1000;
      for (let index = 0; index < steps; index += 1) {
        const acceleration = (
          -SHEET_SPRING.stiffness * (position - target)
          - SHEET_SPRING.damping * velocity
        ) / SHEET_SPRING.mass;
        velocity += acceleration * delta;
        position += velocity * delta;
      }
      animationVelocity.current = velocity;
      setOffsetValue(position);
      if (Math.abs(position - target) > 0.5 || Math.abs(velocity) > 5) {
        frame.current = requestAnimationFrame(tick);
      } else {
        frame.current = undefined;
        animationVelocity.current = 0;
        setOffsetValue(target);
        onComplete();
      }
    };
    frame.current = requestAnimationFrame(tick);
  }, [cancelAnimation, setOffsetValue]);

  const finishClose = useCallback((notify: boolean) => {
    phase.current = "closed";
    pointer.current = undefined;
    setDragging(false);
    setPresent(false);
    if (notify) onCloseRef.current();
  }, []);

  const startClose = useCallback((notify: boolean, initialVelocity = animationVelocity.current) => {
    if (!present || phase.current === "closing") return;
    if (notify && canCloseRef.current && !canCloseRef.current()) {
      phase.current = "idle";
      setDragging(false);
      return;
    }
    phase.current = "closing";
    setDragging(false);
    if (reducedMotion.current) {
      setOffsetValue(0);
      animateOpacity(0, () => finishClose(notify));
      return;
    }
    setOpacityValue(1);
    const height = sheetRef.current?.getBoundingClientRect().height ?? 0;
    if (height <= 0) {
      setOffsetValue(0);
      finishClose(notify);
      return;
    }
    animateSpring(height, initialVelocity, () => finishClose(notify));
  }, [animateOpacity, animateSpring, finishClose, present, setOffsetValue, setOpacityValue]);

  useLayoutEffect(() => {
    if (!open) {
      if (present && phase.current !== "closing") startClose(false);
      return;
    }
    if (!present) {
      setPresent(true);
      return;
    }
    // React StrictMode 会在开发环境重放副作用；如果首次打开帧刚被清理，
    // 允许第二次 layout effect 重新排队，避免 Sheet 永远停在屏幕底部。
    const openingAnimationWasCancelled = phase.current === "opening" && frame.current === undefined;
    if (phase.current !== "closed" && phase.current !== "closing" && !openingAnimationWasCancelled) return;

    const openingFromClosed = phase.current === "closed";
    phase.current = "opening";
    if (reducedMotion.current) {
      setOffsetValue(0);
      if (openingFromClosed) setOpacityValue(0);
      animateOpacity(1, () => { phase.current = "idle"; });
      return;
    }
    setOpacityValue(1);
    if (openingFromClosed) {
      const height = sheetRef.current?.getBoundingClientRect().height ?? 0;
      if (height <= 0) {
        setOffsetValue(0);
        phase.current = "idle";
        return;
      }
      setOffsetValue(height);
      animationVelocity.current = 0;
    }
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined;
      animateSpring(0, animationVelocity.current, () => { phase.current = "idle"; });
    });
  }, [animateOpacity, animateSpring, open, present, setOffsetValue, setOpacityValue, startClose]);

  useEffect(() => {
    if (!present) return;
    if (openSheetCount === 0) previousBodyOverflow = document.body.style.overflow;
    openSheetCount += 1;
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimation();
      openSheetCount = Math.max(0, openSheetCount - 1);
      if (openSheetCount === 0 && previousBodyOverflow !== undefined) {
        document.body.style.overflow = previousBodyOverflow;
        previousBodyOverflow = undefined;
      }
    };
  }, [cancelAnimation, present]);

  useEffect(() => {
    if (!present) {
      setOverlayStyle({});
      return;
    }
    const viewport = window.visualViewport;
    if (!viewport) return;

    // iOS 键盘只缩小 visualViewport；Overlay 必须跟随可见区域，否则底部 Sheet 会留在键盘后方。
    const updateViewport = () => {
      setOverlayStyle({
        top: `${Math.max(0, viewport.offsetTop)}px`,
        bottom: "auto",
        height: `${Math.max(0, viewport.height)}px`,
      });
    };
    updateViewport();
    viewport.addEventListener("resize", updateViewport);
    viewport.addEventListener("scroll", updateViewport);
    return () => {
      viewport.removeEventListener("resize", updateViewport);
      viewport.removeEventListener("scroll", updateViewport);
    };
  }, [present]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => { reducedMotion.current = media.matches; };
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  const rubberband = (distance: number) => {
    const dimension = sheetRef.current?.getBoundingClientRect().height || window.innerHeight || 640;
    return rubberbandOffset(distance, dimension);
  };

  const settle = (initialVelocity: number) => {
    phase.current = "settling";
    if (reducedMotion.current) {
      setOffsetValue(0);
      phase.current = "idle";
      return;
    }
    animateSpring(0, initialVelocity, () => { phase.current = "idle"; });
  };

  const finish = (event: ReactPointerEvent<HTMLElement>) => {
    const current = pointer.current;
    if (!current || current.id !== event.pointerId) return;
    const element = event.currentTarget;
    if (
      typeof element.hasPointerCapture === "function"
      && element.hasPointerCapture(event.pointerId)
      && typeof element.releasePointerCapture === "function"
    ) element.releasePointerCapture(event.pointerId);
    pointer.current = undefined;
    setDragging(false);
    const height = sheetRef.current?.getBoundingClientRect().height || window.innerHeight || 640;
    const projected = projectSheetOffset(offsetRef.current, current.velocity);
    if (projected > height * 0.28 || current.velocity > 900) startClose(true, current.velocity);
    else settle(current.velocity);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("button, a, input, select, textarea")) return;
    const inheritedVelocity = animationVelocity.current;
    cancelAnimation();
    phase.current = "dragging";
    if (typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    pointer.current = {
      id: event.pointerId,
      startY: event.clientY,
      startOffset: offsetRef.current,
      lastY: event.clientY,
      lastTime: performance.now(),
      velocity: inheritedVelocity,
      locked: false,
    };
    setDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const current = pointer.current;
    if (!current || current.id !== event.pointerId) return;
    const now = performance.now();
    const dy = event.clientY - current.startY;
    if (!current.locked && Math.abs(dy) < 10) return;
    current.locked = true;
    const delta = Math.max(1, now - current.lastTime);
    current.velocity = ((event.clientY - current.lastY) / delta) * 1000;
    current.lastY = event.clientY;
    current.lastTime = now;
    const next = current.startOffset + dy;
    setOffsetValue(next >= 0 ? next : rubberband(next));
    event.preventDefault();
  };

  return {
    present,
    sheetRef,
    overlayStyle,
    requestClose: () => startClose(true),
    headerProps: { onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: finish },
    style: reducedMotion.current
      ? { opacity, transform: "none", willChange: "opacity" }
      : { opacity: 1, transform: `translate3d(0, ${offset}px, 0)`, transition: dragging ? "none" : undefined, willChange: "transform" },
  };
}
