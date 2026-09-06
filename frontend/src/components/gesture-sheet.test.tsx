import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useSheetDrag, projectSheetOffset, rubberbandOffset } from "./gesture-sheet";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalVisualViewport = Object.getOwnPropertyDescriptor(window, "visualViewport");

afterEach(() => {
  cleanup();
  if (originalVisualViewport) Object.defineProperty(window, "visualViewport", originalVisualViewport);
  else Reflect.deleteProperty(window, "visualViewport");
});

function Harness({ open = true, onClose = vi.fn() }: { open?: boolean; onClose?: () => void }) {
  const { sheetRef, overlayStyle, headerProps, style } = useSheetDrag({ open, onClose });
  return <div data-testid="overlay" style={overlayStyle}><section ref={sheetRef} style={style}><header {...headerProps}><span>拖拽标题</span><button type="button">关闭</button></header></section></div>;
}

describe("useSheetDrag", () => {
  it("使用渐进阻尼和短距离速度投影", () => {
    expect(rubberbandOffset(-100, 500)).toBeGreaterThan(-100);
    expect(rubberbandOffset(-100, 500)).toBeLessThan(0);
    expect(projectSheetOffset(80, 500)).toBe(170);
  });

  it("标题栏按住后 1:1 移动，并保持指针捕获", () => {
    render(<Harness />);
    const header = screen.getByText("拖拽标题").parentElement!;
    const capture = vi.fn();
    Object.defineProperty(header, "setPointerCapture", { configurable: true, value: capture });
    fireEvent.pointerDown(header, { pointerId: 7, pointerType: "touch", clientY: 100, button: 0 });
    fireEvent.pointerMove(header, { pointerId: 7, pointerType: "touch", clientY: 180 });
    expect(capture).toHaveBeenCalledWith(7);
    expect(header.parentElement).toHaveStyle({ transform: "translate3d(0, 80px, 0)" });
  });

  it("标题栏按钮不被误识别为拖拽起点，并在打开时锁定背景滚动", () => {
    const { unmount } = render(<Harness />);
    const header = screen.getByText("拖拽标题").parentElement!;
    const close = screen.getByRole("button", { name: "关闭" });
    const capture = vi.fn();
    Object.defineProperty(header, "setPointerCapture", { configurable: true, value: capture });
    fireEvent.pointerDown(close, { pointerId: 8, pointerType: "touch", clientY: 100, button: 0 });
    expect(capture).not.toHaveBeenCalled();
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("跟随 visualViewport 更新 Overlay，并在关闭时清理监听", () => {
    const listeners = new Map<string, EventListener>();
    const viewport = {
      height: 500,
      offsetTop: 120,
      addEventListener: vi.fn((type: string, listener: EventListener) => listeners.set(type, listener)),
      removeEventListener: vi.fn((type: string) => listeners.delete(type)),
    } as unknown as VisualViewport;
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });

    const { rerender } = render(<Harness />);
    expect(screen.getByTestId("overlay")).toHaveStyle({ top: "120px", bottom: "auto", height: "500px" });

    Object.defineProperties(viewport, {
      height: { configurable: true, value: 420 },
      offsetTop: { configurable: true, value: 80 },
    });
    act(() => listeners.get("resize")?.(new Event("resize")));
    expect(screen.getByTestId("overlay")).toHaveStyle({ top: "80px", height: "420px" });

    rerender(<Harness open={false} />);
    expect(viewport.removeEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(viewport.removeEventListener).toHaveBeenCalledWith("scroll", expect.any(Function));
    expect(screen.getByTestId("overlay")).not.toHaveStyle({ top: "80px", height: "420px" });
  });

  it("不支持 visualViewport 时保留原有 CSS 视口布局", () => {
    Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
    render(<Harness />);
    expect(screen.getByTestId("overlay")).not.toHaveAttribute("style");
  });
});
