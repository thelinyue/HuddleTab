import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useSheetDrag, projectSheetOffset, rubberbandOffset } from "./gesture-sheet";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

function Harness({ open = true, onClose = vi.fn() }: { open?: boolean; onClose?: () => void }) {
  const { sheetRef, headerProps, style } = useSheetDrag({ open, onClose });
  return <section ref={sheetRef} style={style}><header {...headerProps}><span>拖拽标题</span><button type="button">关闭</button></header></section>;
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
});
