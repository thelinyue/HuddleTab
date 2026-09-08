import { ArrowLeft, X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";

import { useSheetDrag } from "./gesture-sheet";

export type OverlayProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  onBeforeClose?: () => boolean;
  onBack?: { label: string; onClick: () => void };
  leadingAction?: ReactNode;
  focusKey?: string;
  initialFocus?: "auto" | "mobile-dialog";
  mobileSheet?: {
    maxHeight: number;
    detents?: readonly number[];
    initialDetent?: number;
  };
  className?: string;
  children: ReactNode;
};

/**
 * 全站 Sheet 共用的可访问外壳：关闭请求先完成退场，再提交业务状态；
 * 焦点陷阱、背景滚动锁定、visualViewport 和手势则持续到可见退场结束。
 */
export function Overlay({
  open,
  title,
  onClose,
  onBeforeClose,
  onBack,
  leadingAction,
  focusKey,
  initialFocus = "auto",
  mobileSheet,
  className,
  children,
}: OverlayProps) {
  const titleId = useId();
  const { present, sheetRef, overlayStyle, requestClose, headerProps, style: sheetStyle } = useSheetDrag({ open, onClose, canClose: onBeforeClose, mobileSheet });
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  useEffect(() => {
    if (!present) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [present]);

  useEffect(() => {
    if (!present) return;
    const sheet = sheetRef.current;
    const focusableSelector = "button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])";
    const shouldFocusDialog = initialFocus === "mobile-dialog"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(max-width: 639px)").matches;
    const initialTarget = shouldFocusDialog
      ? sheet
      : sheet?.querySelector<HTMLElement>("[data-overlay-initial-focus]")
        ?? sheet?.querySelector<HTMLElement>("input:not(:disabled), select:not(:disabled), textarea:not(:disabled)")
        ?? sheet?.querySelector<HTMLElement>(focusableSelector);
    initialTarget?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        requestCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !sheet) return;
      const focusable = [...sheet.querySelectorAll<HTMLElement>(focusableSelector)];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [focusKey, initialFocus, present, sheetRef]);

  if (!present) return null;
  return (
    <div className={["form-overlay", className].filter(Boolean).join(" ")} style={overlayStyle} role="presentation">
      <button className="form-overlay__scrim" type="button" aria-hidden="true" tabIndex={-1} onClick={requestClose} />
      <section
        ref={sheetRef}
        style={sheetStyle}
        className="form-overlay__sheet"
        data-mobile-sheet-detents={mobileSheet?.detents?.length ? "true" : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="form-overlay__header" {...headerProps}>
          <div className="form-overlay__header-main">
            {onBack
              ? <button className="icon-button" type="button" aria-label={onBack.label} onClick={onBack.onClick}><ArrowLeft aria-hidden="true" size={20} /></button>
              : leadingAction}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button className="icon-button" type="button" aria-label={`关闭${title}`} onClick={requestClose}><X aria-hidden="true" size={20} /></button>
        </header>
        <div className="form-overlay__body">{children}</div>
      </section>
    </div>
  );
}
