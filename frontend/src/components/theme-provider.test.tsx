import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ThemeProvider,
  useThemePreference,
  type ThemePreference,
} from "./theme-provider";

function ThemeProbe() {
  const { preference, resolvedTheme, setPreference } = useThemePreference();
  return (
    <div>
      <output data-testid="preference">{preference}</output>
      <output data-testid="resolved">{resolvedTheme}</output>
      {(["SYSTEM", "LIGHT", "DARK"] as ThemePreference[]).map((value) => (
        <button key={value} type="button" onClick={() => setPreference(value)}>{value}</button>
      ))}
    </div>
  );
}

let mediaMatches = false;
let mediaListeners: Array<(event: MediaQueryListEvent) => void> = [];

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-theme-preference");
  document.head.innerHTML = '<meta name="theme-color" content="#087f73" />';
  mediaMatches = false;
  mediaListeners = [];
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: mediaMatches,
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      mediaListeners.push(listener);
    },
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      mediaListeners = mediaListeners.filter((candidate) => candidate !== listener);
    },
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(),
  })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-theme-preference");
});

describe("ThemeProvider", () => {
  it("恢复本地三态偏好并同步根节点与 theme-color", () => {
    localStorage.setItem("huddletab-theme", "dark");
    mediaMatches = false;
    render(<ThemeProvider><ThemeProbe /></ThemeProvider>);

    expect(screen.getByTestId("preference")).toHaveTextContent("DARK");
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
    expect(document.documentElement).toHaveClass("dark");
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute("content", "#0d1512");
  });

  it("手动切换立即持久化并应用三态颜色", () => {
    render(<ThemeProvider><ThemeProbe /></ThemeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "DARK" }));

    expect(localStorage.getItem("huddletab-theme")).toBe("dark");
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement).not.toHaveClass("light");
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute("content", "#0d1512");

    fireEvent.click(screen.getByRole("button", { name: "LIGHT" }));
    expect(localStorage.getItem("huddletab-theme")).toBe("light");
    expect(document.documentElement).toHaveClass("light");

    fireEvent.click(screen.getByRole("button", { name: "SYSTEM" }));
    expect(localStorage.getItem("huddletab-theme")).toBe("system");
    expect(document.documentElement).not.toHaveClass("light");
    expect(document.documentElement).not.toHaveClass("dark");
  });

  it("跟随系统时响应 prefers-color-scheme 变化", async () => {
    mediaMatches = true;
    localStorage.setItem("huddletab-theme", "system");
    render(<ThemeProvider><ThemeProbe /></ThemeProvider>);
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");

    mediaMatches = false;
    act(() => {
      for (const listener of mediaListeners) listener({ matches: false } as MediaQueryListEvent);
    });
    await waitFor(() => expect(screen.getByTestId("resolved")).toHaveTextContent("light"));
    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute("content", "#f6f8f7");
  });

  it("兼容旧版 WebKit 的 addListener 系统主题事件", async () => {
    const legacyListeners: Array<(event: MediaQueryListEvent) => void> = [];
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: mediaMatches,
      media: "(prefers-color-scheme: dark)",
      addListener: (listener: (event: MediaQueryListEvent) => void) => legacyListeners.push(listener),
      removeListener: (listener: (event: MediaQueryListEvent) => void) => {
        const index = legacyListeners.indexOf(listener);
        if (index >= 0) legacyListeners.splice(index, 1);
      },
    })));
    mediaMatches = true;
    localStorage.setItem("huddletab-theme", "system");
    render(<ThemeProvider><ThemeProbe /></ThemeProvider>);
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");

    mediaMatches = false;
    act(() => {
      for (const listener of legacyListeners) listener({ matches: false } as MediaQueryListEvent);
    });
    await waitFor(() => expect(screen.getByTestId("resolved")).toHaveTextContent("light"));
  });
});
