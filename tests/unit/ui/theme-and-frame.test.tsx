// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { AppFrame } from "@/components/design-system/app-frame";
import { AppHeader } from "@/components/design-system/app-header";
import { MoneyAmount } from "@/components/design-system/money-amount";
import { StatusBadge } from "@/components/design-system/status-badge";
import { SyncStatus } from "@/components/design-system/sync-status";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

test("核心容器在中等屏幕增加边距，并保持单列与底部安全区", () => {
  render(
    <AppFrame>
      <StatusBadge tone="warning" icon="sync">
        待同步
      </StatusBadge>
    </AppFrame>,
  );

  expect(screen.getByTestId("app-frame")).toHaveClass(
    "max-w-[800px]",
    "mx-auto",
    "min-[481px]:px-6",
    "pb-[calc(5rem+env(safe-area-inset-bottom))]",
  );
  expect(screen.getByText("待同步")).toBeVisible();
  expect(screen.getByRole("img", { name: "同步状态" })).toBeVisible();
});

test("共享输入和标签控件保留 44px 触控目标", () => {
  render(
    <>
      <Input aria-label="金额" />
      <Tabs defaultValue="feed">
        <TabsList>
          <TabsTrigger value="feed">流水</TabsTrigger>
          <TabsTrigger value="members">成员</TabsTrigger>
        </TabsList>
      </Tabs>
    </>,
  );

  expect(screen.getByRole("textbox", { name: "金额" })).toHaveClass("min-h-11");
  expect(screen.getByRole("tab", { name: "流水" })).toHaveClass("min-h-11");
});

test("共享控件将 rounded-lg 限制为 8px", () => {
  const css = readFileSync("src/app/globals.css", "utf8");

  expect(css).toContain("--radius: 0.5rem;");
  expect(css).toContain("--radius-lg: var(--radius);");
});

test("共享展示原语保留标题、金额语义和同步状态文本", () => {
  render(
    <>
      <AppHeader
        eyebrow="活动"
        title="周末露营"
        subtitle="共 4 位成员"
        leading={<button type="button" aria-label="返回" />}
        actions={<button type="button">更多</button>}
      />
      <MoneyAmount currency="CNY" amountMinor={12345n} tone="receivable" />
      <SyncStatus tone="pending" />
    </>,
  );

  expect(screen.getByRole("heading", { name: "周末露营" })).toBeVisible();
  expect(screen.getByText("共 4 位成员")).toBeVisible();
  expect(screen.getByRole("button", { name: "返回" })).toBeVisible();
  expect(screen.getByRole("button", { name: "更多" })).toBeVisible();
  expect(screen.getByText("¥123.45")).toHaveClass("money");
  expect(screen.getByText("¥123.45")).toHaveAttribute(
    "data-money-tone",
    "receivable",
  );
  expect(screen.getByText("等待同步")).toBeVisible();
});
