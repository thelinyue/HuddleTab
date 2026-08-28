// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
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
