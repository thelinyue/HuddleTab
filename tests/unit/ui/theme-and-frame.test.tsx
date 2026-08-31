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
import { QuickExpenseTrigger } from "@/features/expenses/components/quick-expense-trigger";
import ActivityLayout from "@/app/(product)/activities/[activityId]/layout";

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

test("状态标签允许省略图标并保留纯文字语义", () => {
  const { container } = render(
    <StatusBadge tone="success">所有者</StatusBadge>,
  );

  expect(screen.getByText("所有者")).toBeVisible();
  expect(container.querySelector('[role="img"]')).not.toBeInTheDocument();
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

test("共享控件使用 8、12、16px 的 V1 圆角层级", () => {
  const css = readFileSync("src/app/globals.css", "utf8");

  expect(css).toContain("--radius-sm: 0.5rem;");
  expect(css).toContain("--radius-md: 0.75rem;");
  expect(css).toContain("--radius-lg: 1rem;");
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
      <MoneyAmount currency="CNY" amountMinor={0n} tone="settled" />
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
  expect(screen.getByText("¥0.00")).toHaveClass("text-success");
  expect(screen.getByText("等待同步")).toBeVisible();
});

test("共享标题允许合法的长无空格文本在窄屏内断行", () => {
  const longTitle =
    "一次很长很长且没有空格的活动标题用于验证移动端不会溢出容器";
  render(
    <AppHeader
      eyebrow={longTitle}
      title={longTitle}
      subtitle={longTitle}
      actions={<button type="button">更多</button>}
    />,
  );

  expect(screen.getByRole("heading", { name: longTitle })).toHaveClass(
    "[overflow-wrap:anywhere]",
  );
  expect(screen.getAllByText(longTitle)).toHaveLength(3);
  for (const element of screen.getAllByText(longTitle)) {
    expect(element).toHaveClass("[overflow-wrap:anywhere]");
  }
});

test("记一笔按钮避让安全区并锚定居中活动工作区", () => {
  render(
    <QuickExpenseTrigger
      timeZone="Asia/Shanghai"
      context={{
        activity: {
          id: "activity-1",
          baseCurrency: "CNY",
          status: "ACTIVE",
          currentMemberId: "member-1",
          currentUserId: "user-1",
        },
        members: [{ id: "member-1", displayName: "小王", status: "ACTIVE" }],
        preference: {
          lastCategory: null,
          recentParticipantIds: ["member-1"],
          recentPayerIds: ["member-1"],
          recentCurrency: "CNY",
          recentTitles: [],
        },
        permissions: { canCreateExpense: true, canManageMembers: false },
      }}
      onSaved={() => undefined}
    />,
  );

  expect(screen.getByRole("button", { name: "记一笔" })).toHaveClass(
    "bottom-[calc(1rem+env(safe-area-inset-bottom))]",
    "right-[max(calc(1rem+env(safe-area-inset-right)),calc((100vw-800px)/2+1.5rem))]",
    "size-14",
    "rounded-full",
  );
});

test("活动布局退出外层位移动画，避免 fixed FAB 改为相对容器定位", () => {
  render(
    <ActivityLayout>
      <p>活动工作区</p>
    </ActivityLayout>,
  );

  expect(screen.getByText("活动工作区").parentElement).toHaveAttribute(
    "data-page-reveal",
    "false",
  );
});
