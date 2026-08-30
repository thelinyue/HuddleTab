"use client";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/**
 * 同一份表单依据视口采用 Sheet 或 Dialog，避免移动与宽屏分别维护字段、顺序和
 * 校验逻辑。通过 matchMedia 只挂载一个 Radix Overlay，焦点陷阱不会彼此冲突。
 */
export function ResponsiveFormOverlay({
  open,
  onOpenChange,
  title,
  children,
  mobileFullScreen = false,
  headerStart,
  headerEnd,
  returnFocusRef,
  keyboardAware = false,
  footer,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly children: ReactNode;
  readonly mobileFullScreen?: boolean;
  readonly headerStart?: ReactNode;
  readonly headerEnd?: ReactNode;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
  /** 移动端编辑器需要把底部操作固定在软键盘上方时启用。 */
  readonly keyboardAware?: boolean;
  readonly footer?: ReactNode;
}) {
  const [wide, setWide] = useState(false);
  const [viewport, setViewport] = useState<{
    readonly height: number | null;
    readonly keyboardInset: number;
  }>({ height: null, keyboardInset: 0 });
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!window.matchMedia) return;
    const query = window.matchMedia("(min-width: 768px)");
    const update = () => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!open || !keyboardAware || wide) return;
    const visualViewport = window.visualViewport;
    if (!visualViewport) {
      return;
    }
    const syncViewport = () => {
      const height = Math.max(0, Math.round(visualViewport.height));
      const keyboardInset = Math.max(
        0,
        Math.round(window.innerHeight - height - visualViewport.offsetTop),
      );
      setViewport({ height, keyboardInset });
    };
    syncViewport();
    visualViewport.addEventListener("resize", syncViewport);
    visualViewport.addEventListener("scroll", syncViewport);
    return () => {
      visualViewport.removeEventListener("resize", syncViewport);
      visualViewport.removeEventListener("scroll", syncViewport);
    };
  }, [keyboardAware, open, wide]);
  useEffect(() => {
    if (!open || !keyboardAware || viewport.height === null) return;
    const active = document.activeElement;
    if (
      !(active instanceof HTMLElement) ||
      !bodyRef.current?.contains(active)
    ) {
      return;
    }
    window.requestAnimationFrame(() => {
      active.scrollIntoView?.({ block: "nearest" });
    });
  }, [keyboardAware, open, viewport.height, viewport.keyboardInset]);
  if (wide) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={
            keyboardAware
              ? "max-h-[88dvh] max-w-2xl gap-0 overflow-hidden"
              : "max-h-[88dvh] max-w-2xl overflow-y-auto"
          }
          showCloseButton={!headerStart}
          onCloseAutoFocus={(event) => {
            if (!returnFocusRef?.current) return;
            event.preventDefault();
            returnFocusRef.current.focus();
          }}
        >
          <DialogHeader
            className={
              headerStart ? "grid min-h-11 grid-cols-3 items-center" : undefined
            }
          >
            {headerStart ? (
              <div className="justify-self-start">{headerStart}</div>
            ) : null}
            <DialogTitle
              className={
                headerStart ? "min-w-0 truncate text-center" : undefined
              }
            >
              {title}
            </DialogTitle>
            {headerStart ? (
              <div className="justify-self-end">{headerEnd}</div>
            ) : null}
          </DialogHeader>
          {keyboardAware ? (
            <>
              <div
                ref={bodyRef}
                className="min-h-0 overflow-y-auto py-4"
                data-overlay-body="scroll"
              >
                {children}
              </div>
              {footer ? (
                <div data-overlay-footer className="shrink-0 border-t pt-4">
                  {footer}
                </div>
              ) : null}
            </>
          ) : (
            children
          )}
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        onCloseAutoFocus={(event) => {
          if (!returnFocusRef?.current) return;
          event.preventDefault();
          returnFocusRef.current.focus();
        }}
        className={
          mobileFullScreen
            ? "data-[side=bottom]:h-dvh data-[side=bottom]:rounded-none data-[side=bottom]:border-0 max-h-dvh gap-0 overflow-hidden"
            : keyboardAware
              ? "max-h-[88dvh] gap-0 overflow-hidden rounded-t-lg"
              : "max-h-[88dvh] overflow-y-auto rounded-t-lg"
        }
        style={
          keyboardAware && viewport.height !== null
            ? {
                height: mobileFullScreen ? `${viewport.height}px` : undefined,
                maxHeight: `${viewport.height}px`,
                bottom: `${viewport.keyboardInset}px`,
              }
            : undefined
        }
        data-keyboard-aware={keyboardAware ? "true" : undefined}
        data-keyboard-inset={keyboardAware ? viewport.keyboardInset : undefined}
        opaqueOnEnter={mobileFullScreen}
        closeButtonClassName={
          mobileFullScreen
            ? "top-[calc(env(safe-area-inset-top)+0.25rem)] right-auto left-1"
            : undefined
        }
        showCloseButton={!headerStart}
      >
        <SheetHeader
          className={
            headerStart
              ? `grid min-h-12 shrink-0 grid-cols-3 items-center ${
                  mobileFullScreen
                    ? "pt-[env(safe-area-inset-top)] pb-0 px-1"
                    : ""
                }`
              : mobileFullScreen
                ? "min-h-12 shrink-0 items-center justify-center pt-[env(safe-area-inset-top)] pb-0 px-14"
                : undefined
          }
        >
          {headerStart ? (
            <div className="justify-self-start">{headerStart}</div>
          ) : null}
          <SheetTitle
            className={
              mobileFullScreen
                ? "type-section-title min-w-0 truncate text-center"
                : headerStart
                  ? "min-w-0 truncate text-center"
                  : undefined
            }
          >
            {title}
          </SheetTitle>
          {headerStart ? (
            <div className="justify-self-end">{headerEnd}</div>
          ) : null}
        </SheetHeader>
        <div
          ref={bodyRef}
          className={
            keyboardAware
              ? "flex min-h-0 flex-1 flex-col overflow-y-auto px-4"
              : mobileFullScreen
                ? "flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
                : "px-4 pb-5"
          }
          data-overlay-body={keyboardAware ? "scroll" : undefined}
          style={
            keyboardAware && viewport.keyboardInset === 0
              ? { paddingBottom: "env(safe-area-inset-bottom)" }
              : undefined
          }
        >
          {children}
        </div>
        {keyboardAware && footer ? (
          <div
            data-overlay-footer
            className="shrink-0 border-t bg-popover px-4 pt-3"
            style={{
              paddingBottom:
                viewport.keyboardInset === 0
                  ? "calc(0.75rem + env(safe-area-inset-bottom))"
                  : "0.75rem",
            }}
          >
            {footer}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
