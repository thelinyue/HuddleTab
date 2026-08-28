"use client";

import { gsap } from "gsap";
import { useRef, type RefObject } from "react";

import {
  motionDuration,
  motionEase,
  useMotionGSAP,
} from "@/components/design-system/motion";
import { isMotionSafeTarget } from "@/components/design-system/motion-target";

/**
 * 表单首次挂载时按 DOM 顺序显现标记字段；错误键变化时只强调当前错误摘要。
 * Hook 不读取或重置字段状态，也不移动焦点，具体表单仍完全拥有校验和提交逻辑。
 */
export function useFormMotion(
  scope: RefObject<HTMLElement | null>,
  errorKey: string,
) {
  const hasEntered = useRef(false);

  useMotionGSAP(
    (reducedMotion) => {
      const root = scope.current;
      if (!root) return;
      const fields = Array.from(
        root.querySelectorAll<HTMLElement>("[data-motion-field]"),
      ).filter(isMotionSafeTarget);
      const error = root.querySelector<HTMLElement>("[data-motion-error]");

      if (!hasEntered.current) {
        if (reducedMotion) {
          gsap.set(fields, { opacity: 1, y: 0 });
        } else {
          gsap.fromTo(
            fields,
            { opacity: 0.01, y: 6 },
            {
              duration: motionDuration.reveal,
              ease: motionEase.enter,
              opacity: 1,
              stagger: 0.035,
              y: 0,
            },
          );
        }
        hasEntered.current = true;
      }

      if (!errorKey || !error) return;
      if (reducedMotion) {
        gsap.set(error, { opacity: 1, y: 0 });
        return;
      }
      gsap.fromTo(
        error,
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
    { dependencies: [errorKey], scope },
  );
}
