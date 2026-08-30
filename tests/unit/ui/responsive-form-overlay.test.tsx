// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { ResponsiveFormOverlay } from "@/features/expenses/components/responsive-form-overlay";

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("键盘感知模式监听 visualViewport，并保留可见滚动正文与固定底部", () => {
  const addEventListener = vi.fn();
  const removeEventListener = vi.fn();
  vi.stubGlobal("visualViewport", {
    height: 520,
    offsetTop: 20,
    addEventListener,
    removeEventListener,
  });

  const { unmount } = render(
    <ResponsiveFormOverlay
      open
      onOpenChange={vi.fn()}
      title="编辑金额"
      mobileFullScreen
      keyboardAware
      footer={<button type="button">保存</button>}
    >
      <label htmlFor="amount">金额</label>
      <input id="amount" inputMode="decimal" />
    </ResponsiveFormOverlay>,
  );

  expect(addEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
  expect(addEventListener).toHaveBeenCalledWith("scroll", expect.any(Function));
  expect(screen.getByLabelText("金额")).toHaveAttribute("inputmode", "decimal");
  expect(screen.getByText("保存").parentElement).toHaveAttribute(
    "data-overlay-footer",
  );
  expect(
    screen.getByRole("dialog").querySelector("[data-overlay-body=scroll]"),
  ).toHaveClass("min-h-0", "overflow-y-auto");
  expect(screen.getByRole("dialog")).toHaveStyle({
    height: "520px",
    bottom: `${window.innerHeight - 520 - 20}px`,
  });

  unmount();
  expect(removeEventListener).toHaveBeenCalledWith(
    "resize",
    expect.any(Function),
  );
  expect(removeEventListener).toHaveBeenCalledWith(
    "scroll",
    expect.any(Function),
  );
});

test("桌面键盘感知 Dialog 同样渲染独立滚动区和保存栏", async () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );

  render(
    <ResponsiveFormOverlay
      open
      onOpenChange={vi.fn()}
      title="编辑金额"
      keyboardAware
      footer={<button type="button">保存</button>}
    >
      <label htmlFor="desktop-amount">金额</label>
      <input id="desktop-amount" />
    </ResponsiveFormOverlay>,
  );

  await waitFor(() =>
    expect(screen.getByRole("dialog")).not.toHaveAttribute("data-side"),
  );
  expect(
    screen.getByRole("dialog").querySelector("[data-overlay-body=scroll]"),
  ).toBeInTheDocument();
  expect(screen.getByText("保存").parentElement).toHaveAttribute(
    "data-overlay-footer",
  );
});

test("快速记账在移动端使用全高 Sheet 和左侧中文关闭按钮", () => {
  render(
    <ResponsiveFormOverlay
      open
      onOpenChange={vi.fn()}
      title="记一笔"
      mobileFullScreen
    >
      <p>快捷录入</p>
    </ResponsiveFormOverlay>,
  );

  expect(screen.getByRole("dialog")).toHaveClass(
    "data-[side=bottom]:h-dvh",
    "data-[side=bottom]:rounded-none",
    "data-[side=bottom]:border-0",
  );
  expect(screen.getByRole("dialog")).toHaveAttribute(
    "data-motion-opaque",
    "true",
  );
  expect(screen.getByRole("heading", { name: "记一笔" })).toBeVisible();
  expect(screen.getByRole("button", { name: "关闭" })).toHaveClass(
    "left-1",
    "right-auto",
    "top-[calc(env(safe-area-inset-top)+0.25rem)]",
  );
  expect(
    screen.getByRole("heading", { name: "记一笔" }).parentElement,
  ).toHaveClass("pt-[env(safe-area-inset-top)]");
});

test("自定义头部操作与默认关闭按钮互斥", () => {
  render(
    <ResponsiveFormOverlay
      open
      onOpenChange={vi.fn()}
      title="分摊设置"
      mobileFullScreen
      headerStart={<button aria-label="返回快速记账">返回</button>}
      headerEnd={<button aria-label="完成">完成</button>}
    >
      <p>分摊内容</p>
    </ResponsiveFormOverlay>,
  );

  expect(screen.getByRole("heading", { name: "分摊设置" })).toBeVisible();
  expect(screen.getByRole("button", { name: "返回快速记账" })).toBeVisible();
  expect(screen.getByRole("button", { name: "完成" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "关闭" }),
  ).not.toBeInTheDocument();
});
