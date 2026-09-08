import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Overlay } from "./overlay";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function installAnimationFrame() {
  let now = 0;
  let id = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callbacks.set(++id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (frameId: number) => callbacks.delete(frameId));
  return () => {
    for (let index = 0; index < 240 && callbacks.size > 0; index += 1) {
      now += 16;
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback(now));
    }
  };
}

function Harness() {
  const [open, setOpen] = useState(false);
  return <><button type="button" onClick={() => setOpen(true)}>打开面板</button><Overlay open={open} title="测试面板" onClose={() => setOpen(false)}><input aria-label="面板输入" /></Overlay></>;
}

describe("共享 Overlay", () => {
  it("退场完成前维持背景锁定，完成后回还焦点", () => {
    const flush = installAnimationFrame();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 320, height: 400, top: 0, right: 320, bottom: 400, left: 0, x: 0, y: 0, toJSON() {},
    });
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "打开面板" });
    trigger.focus();
    fireEvent.click(trigger);
    act(() => flush());
    expect(screen.getByRole("textbox", { name: "面板输入" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.body.style.overflow).toBe("hidden");
    expect(trigger).not.toHaveFocus();
    act(() => flush());
    expect(screen.queryByRole("dialog", { name: "测试面板" })).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
    expect(trigger).toHaveFocus();
  });

  it("外部状态关闭时保留组件到退场结束且不重复调用 onClose", () => {
    const flush = installAnimationFrame();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 320, height: 400, top: 0, right: 320, bottom: 400, left: 0, x: 0, y: 0, toJSON() {},
    });
    const onClose = vi.fn();
    const view = render(<Overlay open title="外部面板" onClose={onClose}><input aria-label="内容" /></Overlay>);
    act(() => flush());

    view.rerender(<Overlay open={false} title="外部面板" onClose={onClose}><input aria-label="内容" /></Overlay>);
    expect(screen.getByRole("dialog", { name: "外部面板" })).toBeInTheDocument();
    act(() => flush());
    expect(screen.queryByRole("dialog", { name: "外部面板" })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("移动端可先聚焦 Sheet 容器，不自动唤起输入法", () => {
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
      matches: query === "(max-width: 639px)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));

    render(
      <Overlay open title="移动面板" initialFocus="mobile-dialog" onClose={vi.fn()}>
        <input aria-label="金额" data-overlay-initial-focus />
      </Overlay>,
    );

    expect(screen.getByRole("dialog", { name: "移动面板" })).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "金额" })).not.toHaveFocus();
  });
});
