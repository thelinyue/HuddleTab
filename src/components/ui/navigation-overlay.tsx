"use client";

import type { ReactNode, RefObject } from "react";
import { ChevronLeftIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ResponsiveFormOverlay } from "@/features/expenses/components/responsive-form-overlay";

/**
 * 业务流程的统一导航壳。
 *
 * 外层只负责打开/关闭整个 Overlay，业务子视图通过 onBack 在本地栈中退回；
 * 这里不提供任意头部插槽，避免调用方再拼出第二排导航。根视图左侧使用等宽
 * 占位保持标题居中，子视图则显示 Back，Close 永远直接关闭整个 Overlay。
 */
export function NavigationOverlay({
  open,
  onOpenChange,
  title,
  onBack,
  backLabel = "上一级",
  children,
  mobileFullScreen = false,
  returnFocusRef,
  keyboardAware = false,
  footer,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly onBack?: () => void;
  readonly backLabel?: string;
  readonly children: ReactNode;
  readonly mobileFullScreen?: boolean;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
  readonly keyboardAware?: boolean;
  readonly footer?: ReactNode;
}) {
  const headerStart = onBack ? (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={`返回${backLabel}`}
      title={`返回${backLabel}`}
      onClick={onBack}
      className="gap-1 px-1"
    >
      <ChevronLeftIcon aria-hidden="true" />
      <span className="sr-only">返回{backLabel}</span>
    </Button>
  ) : (
    <span aria-hidden="true" className="size-11" />
  );
  const close = (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label="关闭"
      title="关闭"
      onClick={() => onOpenChange(false)}
    >
      <XIcon aria-hidden="true" />
    </Button>
  );

  return (
    <ResponsiveFormOverlay
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      mobileFullScreen={mobileFullScreen}
      headerStart={headerStart}
      headerEnd={close}
      returnFocusRef={returnFocusRef}
      keyboardAware={keyboardAware}
      footer={footer}
    >
      {children}
    </ResponsiveFormOverlay>
  );
}
