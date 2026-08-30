"use client";

import * as React from "react";
import { Dialog as SheetPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  OverlayMotionRoot,
  useOverlayMotion,
  useOverlayMotionState,
} from "@/components/ui/overlay-motion";
import { XIcon } from "lucide-react";

function Sheet({
  defaultOpen,
  onOpenChange,
  open,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return (
    <OverlayMotionRoot
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      open={open}
    >
      {(motionProps) => (
        <SheetPrimitive.Root data-slot="sheet" {...props} {...motionProps} />
      )}
    </OverlayMotionRoot>
  );
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({
  forceMount,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  const motion = useOverlayMotionState();
  return (
    <SheetPrimitive.Portal
      data-slot="sheet-portal"
      forceMount={forceMount ?? motion.forceMount}
      {...props}
    />
  );
}

function SheetOverlay({
  className,
  inert,
  style,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  const motion = useOverlayMotionState();
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      data-motion-state={motion.phase}
      className={cn("fixed inset-0 z-50 bg-black/25", className)}
      inert={motion.closing ? true : inert}
      style={motion.closing ? { ...style, pointerEvents: "none" } : style}
      {...props}
    />
  );
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  closeButtonClassName,
  opaqueOnEnter = false,
  inert,
  ref,
  style,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left";
  showCloseButton?: boolean;
  closeButtonClassName?: string;
  /** 全屏移动面板保持不透明进入，防止底层活动内容透出。 */
  opaqueOnEnter?: boolean;
}) {
  const { closing, contentRef, overlayRef, phase } = useOverlayMotion({
    forwardedContentRef: ref,
    kind: "sheet",
    side,
    opaqueOnEnter,
  });
  return (
    <SheetPortal>
      <SheetOverlay ref={overlayRef} />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-motion-state={phase}
        data-side={side}
        data-motion-opaque={opaqueOnEnter ? "true" : "false"}
        className={cn(
          "fixed z-50 flex flex-col gap-4 bg-popover bg-clip-padding text-sm text-popover-foreground shadow-overlay data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:rounded-t-lg data-[side=bottom]:border-t data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:rounded-b-lg data-[side=top]:border-b data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm",
          className,
        )}
        inert={closing ? true : inert}
        ref={contentRef}
        style={closing ? { ...style, pointerEvents: "none" } : style}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close data-slot="sheet-close" asChild>
            <Button
              variant="ghost"
              className={cn("absolute top-3 right-3", closeButtonClassName)}
              size="icon-sm"
            >
              <XIcon />
              <span className="sr-only">关闭</span>
            </Button>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-0.5 p-4", className)}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  );
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        "font-heading text-base font-medium text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
