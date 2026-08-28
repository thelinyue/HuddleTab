"use client";

import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { Flip } from "gsap/Flip";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type RefObject,
} from "react";

gsap.registerPlugin(useGSAP, Flip);

/** 短促动效统一使用这些令牌，避免组件各自定义难以协调的时长与缓动。 */
export const motionDuration = {
  brief: 0.18,
  reveal: 0.28,
} as const;

export const motionEase = {
  enter: "power1.out",
  emphasis: "power2.out",
} as const;

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

/**
 * 该 Hook 只订阅系统动态效果偏好，并在卸载时删除媒体查询监听。服务端快照保守地
 * 返回减少动态效果，确保水合前不会创建补间；调用方仍负责直接写入自己的最终状态。
 */
export function useReducedMotion() {
  const subscribe = useCallback((onStoreChange: () => void) => {
    if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
    const media = window.matchMedia(reducedMotionQuery);
    media.addEventListener("change", onStoreChange);
    return () => media.removeEventListener("change", onStoreChange);
  }, []);
  const getSnapshot = useCallback(
    () =>
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia(reducedMotionQuery).matches
        : true,
    [],
  );

  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}

/**
 * GSAP 仅在传入的 scope 内运行，useGSAP 会在更新和卸载时 revert context。减少动态
 * 效果的分支由回调直接设置最终状态，基座本身不创建任何 tween，避免影响键盘和读屏语义。
 */
export function useMotionGSAP(
  callback: (reducedMotion: boolean) => void | (() => void),
  {
    dependencies,
    revertOnUpdate = true,
    scope,
  }: {
    readonly dependencies: readonly unknown[];
    readonly revertOnUpdate?: boolean;
    readonly scope: RefObject<HTMLElement | null>;
  },
) {
  const reducedMotion = useReducedMotion();
  useGSAP(
    () => callback(reducedMotion),
    {
      dependencies: [reducedMotion, ...dependencies],
      revertOnUpdate,
      scope,
    },
  );
  return reducedMotion;
}

/**
 * 尺寸变化只把回调限制在传入的 DOM scope；观察器与窗口监听均由 Hook 在卸载时移除。
 * 调用方可直接重设 transform，避免窗口旋转或容器宽度变化后遗留过期的视觉位置。
 */
export function useScopedResize(
  scope: RefObject<HTMLElement | null>,
  onResize: () => void,
) {
  const onResizeRef = useRef(onResize);
  useLayoutEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  useEffect(() => {
    const target = scope.current;
    if (!target) return;
    const handleResize = () => onResizeRef.current();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(handleResize);
    observer?.observe(target);
    window.addEventListener("resize", handleResize);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, [scope]);
}
