"use client";

import { gsap } from "gsap";
import type { RefObject } from "react";

import {
  motionDuration,
  motionEase,
  useMotionGSAP,
} from "@/components/design-system/motion";

/**
 * 状态提示仅在挂载或调用方状态键变化时轻量显现，不使用弹跳、抖动或循环，
 * 也不改变 role、aria-live 等由具体状态组件负责的语义。
 */
export function useStateMotion(
  scope: RefObject<HTMLElement | null>,
  statusKey: string,
) {
  useMotionGSAP(
    (reducedMotion) => {
      const target = scope.current;
      if (!target) return;
      if (reducedMotion) {
        gsap.set(target, { opacity: 1, y: 0 });
        return;
      }
      gsap.fromTo(
        target,
        { opacity: 0.01, y: 4 },
        {
          duration: motionDuration.brief,
          ease: motionEase.enter,
          opacity: 1,
          overwrite: "auto",
          y: 0,
        },
      );
    },
    { dependencies: [statusKey], scope },
  );
}
