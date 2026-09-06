import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { useSheetDrag, projectSheetOffset, rubberbandOffset } from "./gesture-sheet";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalVisualViewport = Object.getOwnPropertyDescriptor(window, "visualViewport");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalVisualViewport) Object.defineProperty(window, "visualViewport", originalVisualViewport);
  else Reflect.deleteProperty(window, "visualViewport");
});

function mockAnimationFrame() {
  let now = 0;
  let id = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    id += 1;
    callbacks.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (frameId: number) => callbacks.delete(frameId));
  const advance = (milliseconds = 16) => {
    now += milliseconds;
    const pending = [...callbacks.values()];
    callbacks.clear();
    pending.forEach((callback) => callback(now));
  };
  const flush = () => {
    for (let index = 0; index < 240 && callbacks.size > 0; index += 1) advance();
  };
  return { advance, flush };
}

function Harness({ open = true, onClose = vi.fn() }: { open?: boolean; onClose?: () => void }) {
  const { present, sheetRef, overlayStyle, requestClose, headerProps, style } = useSheetDrag({ open, onClose });
  if (!present) return null;
  return <div data-testid="overlay" style={overlayStyle}><section ref={sheetRef} style={style}><header {...headerProps}><span>拖拽标题</span><button type="button">关闭</button></header><button type="button" onClick={requestClose}>物理关闭</button></section></div>;
}

function ClosingHarness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true);
  return <Harness open={open} onClose={() => { onClose(); setOpen(false); }} />;
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
    expect(screen.queryByTestId("overlay")).not.toBeInTheDocument();
  });

  it("不支持 visualViewport 时保留原有 CSS 视口布局", () => {
    Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
    render(<Harness />);
    expect(screen.getByTestId("overlay")).not.toHaveAttribute("style");
  });

  it("回弹途中重新抓取时从当前展示偏移继续，不跳回逻辑目标", () => {
    const animation = mockAnimationFrame();
    render(<Harness />);
    const header = screen.getByText("拖拽标题").parentElement!;
    Object.defineProperty(header.parentElement!, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ width: 320, height: 400, top: 0, right: 320, bottom: 400, left: 0, x: 0, y: 0, toJSON() {} }),
    });

    fireEvent.pointerDown(header, { pointerId: 11, pointerType: "touch", clientY: 100, button: 0 });
    animation.advance(400);
    fireEvent.pointerMove(header, { pointerId: 11, pointerType: "touch", clientY: 140 });
    fireEvent.pointerUp(header, { pointerId: 11, pointerType: "touch", clientY: 140 });
    act(() => { animation.advance(); animation.advance(); animation.advance(); });
    const currentOffset = Number(header.parentElement!.style.transform.match(/, ([\d.-]+)px/)?.[1]);

    fireEvent.pointerDown(header, { pointerId: 12, pointerType: "touch", clientY: 200, button: 0 });
    fireEvent.pointerMove(header, { pointerId: 12, pointerType: "touch", clientY: 230 });
    const grabbedOffset = Number(header.parentElement!.style.transform.match(/, ([\d.-]+)px/)?.[1]);
    expect(grabbedOffset).toBeCloseTo(currentOffset + 30, 3);
  });

  it("拖拽关闭继承释放速度，并在弹簧退场后才提交关闭", () => {
    const animation = mockAnimationFrame();
    const onClose = vi.fn();
    render(<ClosingHarness onClose={onClose} />);
    const header = screen.getByText("拖拽标题").parentElement!;
    Object.defineProperty(header.parentElement!, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ width: 320, height: 400, top: 0, right: 320, bottom: 400, left: 0, x: 0, y: 0, toJSON() {} }),
    });

    fireEvent.pointerDown(header, { pointerId: 13, pointerType: "touch", clientY: 100, button: 0 });
    animation.advance(200);
    fireEvent.pointerMove(header, { pointerId: 13, pointerType: "touch", clientY: 220 });
    fireEvent.pointerUp(header, { pointerId: 13, pointerType: "touch", clientY: 220 });
    expect(onClose).not.toHaveBeenCalled();
    expect(document.body.style.overflow).toBe("hidden");

    act(() => animation.flush());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("overlay")).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
  });

  it("减少动态效果时只做短透明度退场", () => {
    const animation = mockAnimationFrame();
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    act(() => animation.flush());
    const sheet = screen.getByText("拖拽标题").closest("section")!;
    expect(sheet).toHaveStyle({ transform: "none", opacity: "1" });

    fireEvent.click(screen.getByRole("button", { name: "物理关闭" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(sheet.style.transform).toBe("none");
    act(() => animation.flush());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
