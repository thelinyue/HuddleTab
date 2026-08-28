"use client";

import { gsap } from "gsap";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  motionDuration,
  motionEase,
  useMotionGSAP,
} from "@/components/design-system/motion";
import { isMotionSafeTarget } from "@/components/design-system/motion-target";

/**
 * 页面入场只处理 main 的直接子节点，保持标题、操作与正文的 DOM/键盘顺序不变。
 * opacity 不会把可聚焦内容移出无障碍树，减少动态效果时则直接写入最终视觉状态。
 */
export function PageReveal({
  children,
  className,
  testId,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly testId?: string;
}) {
  const scope = useRef<HTMLElement>(null);
  const previousChildren = useRef(children);
  const ignoreNextChildMutation = useRef(false);
  const [contentRevision, setContentRevision] = useState(0);

  useEffect(() => {
    const root = scope.current;
    if (!root || typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver((records) => {
      if (!records.some((record) => record.type === "childList")) return;
      if (ignoreNextChildMutation.current) {
        ignoreNextChildMutation.current = false;
        return;
      }
      setContentRevision((revision) => revision + 1);
    });
    observer.observe(root, { childList: true });
    return () => observer.disconnect();
  }, []);

  useMotionGSAP(
    (reducedMotion) => {
      if (previousChildren.current !== children) {
        previousChildren.current = children;
        ignoreNextChildMutation.current = true;
      }
      const targets = Array.from(scope.current?.children ?? []).filter(
        isMotionSafeTarget,
      );
      if (!targets.length) return;
      if (reducedMotion) {
        gsap.set(targets, { opacity: 1, y: 0 });
        return;
      }
      gsap.fromTo(
        targets,
        { opacity: 0.01, y: 8 },
        {
          duration: motionDuration.reveal,
          ease: motionEase.enter,
          opacity: 1,
          stagger: 0.035,
          y: 0,
        },
      );
    },
    { dependencies: [children, contentRevision], scope },
  );

  return (
    <main ref={scope} data-testid={testId} className={className}>
      {children}
    </main>
  );
}
