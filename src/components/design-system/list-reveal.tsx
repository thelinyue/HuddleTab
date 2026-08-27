"use client";

import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import type { ReactNode } from "react";
import { useRef } from "react";

import { cn } from "@/lib/utils";

gsap.registerPlugin(useGSAP);

/**
 * 列表入场动画限制在自身容器内，并由 useGSAP 在卸载时恢复内联样式；这样页面切换
 * 不会留下悬挂 tween。减少动态效果时直接写入最终状态，避免位移动画。
 */
export function ListReveal({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  const container = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      const targets = "[data-list-reveal]";

      media.add("(prefers-reduced-motion: reduce)", () => {
        gsap.set(targets, { autoAlpha: 1, y: 0 });
      });
      media.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.fromTo(
          targets,
          { autoAlpha: 0, y: 8 },
          { autoAlpha: 1, y: 0, duration: 0.28, ease: "power1.out", stagger: 0.03 },
        );
      });

      return () => media.revert();
    },
    { scope: container },
  );

  return <div ref={container} className={cn(className)}>{children}</div>;
}
