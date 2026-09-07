import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PWA_SLOW_STATUS_DELAY_MS, PwaLaunchScreen } from "./pwa-launch-screen";

function stubMatchMedia(reducedMotion = false) {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: reducedMotion && query === "(prefers-reduced-motion: reduce)",
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: () => true,
  })));
}

describe("PwaLaunchScreen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubMatchMedia();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("立即显示品牌图标，并只在等待超过一秒后显示状态文字", () => {
    render(<PwaLaunchScreen />);

    expect(screen.getByRole("status", { name: "正在准备伙记" })).toBeInTheDocument();
    expect(screen.queryByText("正在准备伙记…")).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(PWA_SLOW_STATUS_DELAY_MS - 1));
    expect(screen.queryByText("正在准备伙记…")).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText("正在准备伙记…")).toBeInTheDocument();
  });

  it("卸载时清理慢状态定时器", () => {
    const { unmount } = render(<PwaLaunchScreen />);
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("减少动态效果时不等待动画即可显示状态", () => {
    stubMatchMedia(true);
    render(<PwaLaunchScreen />);

    act(() => vi.advanceTimersByTime(PWA_SLOW_STATUS_DELAY_MS));
    expect(screen.getByText("正在准备伙记…")).toBeInTheDocument();
  });
});
