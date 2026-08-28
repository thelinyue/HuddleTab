"use client";

import { useEffect, useState, type ReactNode } from "react";

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
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly children: ReactNode;
  readonly mobileFullScreen?: boolean;
  readonly headerStart?: ReactNode;
  readonly headerEnd?: ReactNode;
}) {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    if (!window.matchMedia) return;
    const query = window.matchMedia("(min-width: 768px)");
    const update = () => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  if (wide) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-h-[88dvh] max-w-2xl overflow-y-auto"
          showCloseButton={!headerStart}
        >
          <DialogHeader
            className={
              headerStart ? "grid min-h-11 grid-cols-3 items-center" : undefined
            }
          >
            {headerStart ? (
              <div className="justify-self-start">{headerStart}</div>
            ) : null}
            <DialogTitle className={headerStart ? "text-center" : undefined}>
              {title}
            </DialogTitle>
            {headerStart ? (
              <div className="justify-self-end">{headerEnd}</div>
            ) : null}
          </DialogHeader>
          {children}
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className={
          mobileFullScreen
            ? "data-[side=bottom]:h-dvh data-[side=bottom]:rounded-none data-[side=bottom]:border-0 max-h-dvh gap-0 overflow-hidden"
            : "max-h-[88dvh] overflow-y-auto rounded-t-lg"
        }
        closeButtonClassName={
          mobileFullScreen
            ? "top-[calc(env(safe-area-inset-top)+0.25rem)] right-auto left-1"
            : undefined
        }
        showCloseButton={!headerStart}
      >
        <SheetHeader
          className={
            mobileFullScreen
              ? `min-h-12 shrink-0 items-center pt-[env(safe-area-inset-top)] pb-0 ${
                  headerStart ? "grid grid-cols-3 px-1" : "justify-center px-14"
                }`
              : undefined
          }
        >
          {headerStart ? (
            <div className="justify-self-start">{headerStart}</div>
          ) : null}
          <SheetTitle
            className={
              mobileFullScreen
                ? "type-section-title text-center"
                : headerStart
                  ? "text-center"
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
          className={
            mobileFullScreen
              ? "flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
              : "px-4 pb-5"
          }
        >
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
