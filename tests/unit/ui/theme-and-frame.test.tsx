// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { AppFrame } from "@/components/design-system/app-frame";
import { AppHeader } from "@/components/design-system/app-header";
import { MoneyAmount } from "@/components/design-system/money-amount";
import { StatusBadge } from "@/components/design-system/status-badge";
import { SyncStatus } from "@/components/design-system/sync-status";

test("核心容器居中加宽且状态不只依赖颜色", () => {
  render(
    <AppFrame>
      <StatusBadge tone="warning" icon="sync">
        待同步
      </StatusBadge>
    </AppFrame>,
  );

  expect(screen.getByTestId("app-frame")).toHaveClass("max-w-3xl", "mx-auto");
  expect(screen.getByText("待同步")).toBeVisible();
  expect(screen.getByRole("img", { name: "同步状态" })).toBeVisible();
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
