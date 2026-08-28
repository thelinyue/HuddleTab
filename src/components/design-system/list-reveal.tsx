"use client";

import { gsap } from "gsap";
import { Flip } from "gsap/Flip";
import { Component, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import {
  motionDuration,
  motionEase,
  useMotionGSAP,
} from "@/components/design-system/motion";

/**
 * 这个快照边界在 React 提交 DOM 更新前读取父容器内稳定列表项的位置。它不渲染额外
 * DOM，也不承担动效；父组件会在提交后、受 scope 限制的 GSAP context 中消费快照。
 */
class ListRevealSnapshotBoundary extends Component<{
  readonly captureSnapshot: () => void;
  readonly children: ReactNode;
  readonly version: ReactNode;
}> {
  getSnapshotBeforeUpdate(previousProps: Readonly<{ version: ReactNode }>) {
    if (previousProps.version !== this.props.version) {
      this.props.captureSnapshot();
    }
    return null;
  }

  componentDidUpdate() {
    // React 要求快照生命周期配对；提交后的 Flip 仍由父级 useGSAP context 统一管理。
  }

  render() {
    return this.props.children;
  }
}

/**
 * 列表动效只查询自身容器的稳定 data-list-reveal 项。提交前快照由内部边界取得，提交后
 * 才在 useGSAP context 中运行 Flip，因此动画会随 context 在更新或卸载时回收。入场仅改变
 * opacity 和 transform，绝不以 visibility 隐藏行内链接等交互语义。
 */
export function ListReveal({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const previousLayout = useRef<ReturnType<typeof Flip.getState> | null>(null);
  const hasRendered = useRef(false);
  const reducedMotion = useRef(false);
  const skipNextNormalMotion = useRef(false);

  const captureSnapshot = () => {
    if (
      reducedMotion.current ||
      skipNextNormalMotion.current ||
      !hasRendered.current
    )
      return;
    const targets = Array.from(
      container.current?.querySelectorAll<HTMLElement>("[data-list-reveal]") ?? [],
    );
    previousLayout.current = targets.length ? Flip.getState(targets) : null;
  };

  useMotionGSAP(
    (prefersReducedMotion) => {
      reducedMotion.current = prefersReducedMotion;
      const targets = Array.from(
        container.current?.querySelectorAll<HTMLElement>("[data-list-reveal]") ?? [],
      );
      if (!targets.length) return;
      if (prefersReducedMotion) {
        gsap.set(targets, { opacity: 1, y: 0 });
        hasRendered.current = true;
        previousLayout.current = null;
        skipNextNormalMotion.current = true;
      } else if (skipNextNormalMotion.current) {
        previousLayout.current = null;
        skipNextNormalMotion.current = false;
      } else if (!hasRendered.current) {
        gsap.fromTo(
          targets,
          { opacity: 0.01, y: 8 },
          {
            opacity: 1,
            y: 0,
            duration: motionDuration.reveal,
            ease: motionEase.enter,
            stagger: 0.03,
          },
        );
        hasRendered.current = true;
      } else if (previousLayout.current) {
        Flip.from(previousLayout.current, {
          duration: motionDuration.brief,
          ease: motionEase.enter,
          scale: true,
        });
        previousLayout.current = null;
      }
    },
    { dependencies: [children], scope: container },
  );

  return (
    <div ref={container} className={cn(className)}>
      <ListRevealSnapshotBoundary
        captureSnapshot={captureSnapshot}
        version={children}
      >
        {children}
      </ListRevealSnapshotBoundary>
    </div>
  );
}

/** 调用方用此项包装每一行，无需了解内部动画选择器。 */
export function ListRevealItem({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div data-list-reveal className={cn(className)}>
      {children}
    </div>
  );
}
