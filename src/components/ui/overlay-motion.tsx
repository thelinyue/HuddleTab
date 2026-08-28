"use client";

import { gsap } from "gsap";
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";

import {
  motionDuration,
  motionEase,
  useMotionGSAP,
} from "@/components/design-system/motion";

type OverlayMotionPhase = "closed" | "closing" | "open";
type OverlayMotionKind = "dialog" | "sheet";
type SheetSide = "top" | "right" | "bottom" | "left";

type OverlayMotionContextValue = {
  readonly exitGeneration: number;
  readonly finishExit: (exitGeneration: number) => void;
  readonly phase: OverlayMotionPhase;
};

type OverlayPresenceState = {
  readonly exitComplete: boolean;
  readonly exitGeneration: number;
  readonly requestedOpen: boolean;
};

const OverlayMotionContext = createContext<OverlayMotionContextValue | null>(
  null,
);

function useOverlayMotionContext() {
  const context = useContext(OverlayMotionContext);
  if (!context) {
    throw new Error(
      "弹层动效组件必须放在对应的 Dialog、Sheet 或 AlertDialog 中。",
    );
  }
  return context;
}

/**
 * Root 立即把业务 open 状态交给 Radix，使焦点陷阱和外部指针锁按原语义解除；仅在
 * closing 阶段临时 forceMount Portal。GSAP 完成后撤销保留，Radix 才真正卸载
 * FocusScope 并把焦点还给原触发器；每轮离场使用独立 generation，陈旧完成回调不会
 * 结束重开后的新一轮离场。
 */
function OverlayMotionRoot({
  children,
  defaultOpen,
  onOpenChange,
  open,
}: {
  readonly children: (props: {
    readonly onOpenChange: (open: boolean) => void;
    readonly open: boolean;
  }) => ReactNode;
  readonly defaultOpen?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly open?: boolean;
}) {
  const controlled = open !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(
    defaultOpen ?? false,
  );
  const requestedOpen = controlled ? open : uncontrolledOpen;
  const [presence, setPresence] = useState<OverlayPresenceState>(() => ({
    exitComplete: !requestedOpen,
    exitGeneration: 0,
    requestedOpen,
  }));

  if (presence.requestedOpen !== requestedOpen) {
    setPresence({
      exitComplete: false,
      exitGeneration: requestedOpen
        ? presence.exitGeneration
        : presence.exitGeneration + 1,
      requestedOpen,
    });
  }

  const finishExit = useCallback((exitGeneration: number) => {
    setPresence((current) => {
      if (
        current.requestedOpen ||
        current.exitComplete ||
        current.exitGeneration !== exitGeneration
      ) {
        return current;
      }
      return { ...current, exitComplete: true };
    });
  }, []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!controlled) setUncontrolledOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [controlled, onOpenChange],
  );

  const phase: OverlayMotionPhase = requestedOpen
    ? "open"
    : presence.exitComplete
      ? "closed"
      : "closing";

  return (
    <OverlayMotionContext.Provider
      value={{
        exitGeneration: presence.exitGeneration,
        finishExit,
        phase,
      }}
    >
      {children({ onOpenChange: handleOpenChange, open: requestedOpen })}
    </OverlayMotionContext.Provider>
  );
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  if (ref) ref.current = value;
}

function getSheetTransform(side: SheetSide) {
  switch (side) {
    case "top":
      return { scale: 1, x: 0, y: -24 };
    case "right":
      return { scale: 1, x: 24, y: 0 };
    case "bottom":
      return { scale: 1, x: 0, y: 24 };
    case "left":
      return { scale: 1, x: -24, y: 0 };
  }
}

/**
 * 每个 Content 实例持有自己的内容 ref 和可选遮罩 ref，并把 Content 作为 useGSAP
 * scope。非模态 Radix 不渲染遮罩，生命周期仍由 Content 独立完成；useMotionGSAP 会在
 * phase 更新或卸载时 revert context，因此离场中重开会清理旧 tween。减少动态效果
 * 分支只 set 最终状态并同步结束，不延长 Radix 的焦点边界。
 */
function useOverlayMotion({
  forwardedContentRef,
  kind,
  side = "right",
}: {
  readonly forwardedContentRef?: Ref<HTMLDivElement>;
  readonly kind: OverlayMotionKind;
  readonly side?: SheetSide;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const contentElementRef = useRef<HTMLDivElement>(null);
  const [contentReady, setContentReady] = useState(false);
  const { exitGeneration, finishExit, phase } = useOverlayMotionContext();
  const completeExit = useCallback(
    () => finishExit(exitGeneration),
    [exitGeneration, finishExit],
  );
  const updateContentReady = useCallback(() => {
    const ready = Boolean(contentElementRef.current);
    setContentReady((current) => (current === ready ? current : ready));
  }, []);
  const setOverlayRef = useCallback((node: HTMLDivElement | null) => {
    overlayRef.current = node;
  }, []);
  const contentRef = useCallback(
    (node: HTMLDivElement | null) => {
      contentElementRef.current = node;
      assignRef(forwardedContentRef, node);
      updateContentReady();
    },
    [forwardedContentRef, updateContentReady],
  );

  useMotionGSAP(
    (reducedMotion) => {
      const content = contentElementRef.current;
      const overlay = overlayRef.current;
      if (!content || phase === "closed") return;

      const displaced =
        kind === "sheet"
          ? getSheetTransform(side)
          : { scale: 0.98, x: 0, y: 8 };
      const settled = { autoAlpha: 1, scale: 1, x: 0, y: 0 };

      if (phase === "open") {
        if (reducedMotion) {
          if (overlay) gsap.set(overlay, { autoAlpha: 1 });
          gsap.set(content, settled);
          return;
        }
        if (overlay) {
          gsap.fromTo(
            overlay,
            { autoAlpha: 0 },
            {
              autoAlpha: 1,
              duration: motionDuration.brief,
              ease: motionEase.enter,
              immediateRender: false,
            },
          );
        }
        gsap.fromTo(
          content,
          { autoAlpha: 0, ...displaced },
          {
            ...settled,
            duration: motionDuration.brief,
            ease: motionEase.enter,
            immediateRender: false,
          },
        );
        return;
      }

      if (reducedMotion) {
        if (overlay) gsap.set(overlay, { autoAlpha: 0 });
        gsap.set(content, { autoAlpha: 0, ...displaced });
        completeExit();
        return;
      }

      if (overlay) {
        gsap.to(overlay, {
          autoAlpha: 0,
          duration: motionDuration.brief,
          ease: motionEase.enter,
        });
      }
      gsap.to(content, {
        autoAlpha: 0,
        ...displaced,
        duration: motionDuration.brief,
        ease: motionEase.enter,
        onComplete: completeExit,
      });
    },
    {
      dependencies: [phase, kind, side, completeExit, contentReady],
      scope: contentElementRef,
    },
  );

  return {
    closing: phase === "closing",
    contentRef,
    overlayRef: setOverlayRef,
    phase,
  } as const;
}

function useOverlayMotionState() {
  const { phase } = useOverlayMotionContext();
  return {
    closing: phase === "closing",
    forceMount: phase === "closing" ? true : undefined,
    phase,
  } as const;
}

export { OverlayMotionRoot, useOverlayMotion, useOverlayMotionState };
