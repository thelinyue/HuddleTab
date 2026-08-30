// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { ExpenseFeed } from "@/features/expenses/components/expense-feed";

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

test("流水只提供名称、固定分类和我参与的筛选", async () => {
  const user = userEvent.setup();
  const onFiltersChange = vi.fn();
  render(
    <ExpenseFeed
      activity={{
        id: "activity-1",
        name: "大阪",
        currency: "CNY",
        totalExpenseMinor: "6000",
        originalCurrencyTotals: [{ currency: "JPY", amountMinor: "6000" }],
        startDate: "2026-08-20",
        endDate: "2026-08-24",
        memberCount: 3,
        expenseCount: 1,
        participatingMemberCount: 2,
        averageExpenseMinor: "150",
      }}
      timeZone="Asia/Shanghai"
      onFiltersChange={onFiltersChange}
      expenses={[
        {
          id: "expense-1",
          title: "一兰拉面",
          category: "FOOD",
          originalAmountMinor: "6000",
          originalCurrency: "JPY",
          baseAmountMinor: "300",
          baseCurrency: "CNY",
          occurredAt: "2026-08-23T08:00:00.000Z",
          payerSummary: "小王",
          participantCount: 2,
        },
      ]}
    />,
  );

  expect(
    screen.queryByRole("searchbox", { name: "搜索消费名称" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "筛选流水" }));
  const filterDialog = screen.getByRole("dialog", { name: "筛选流水" });
  expect(
    within(filterDialog).getByRole("searchbox", { name: "搜索消费名称" }),
  ).toBeVisible();
  const foodFilter = within(filterDialog).getByRole("button", { name: "餐饮" });
  expect(foodFilter).toBeVisible();
  expect(foodFilter.querySelector("svg")).not.toBeNull();
  expect(foodFilter.querySelector("svg")).not.toHaveClass("rounded-full");
  expect(screen.getByRole("checkbox", { name: "只看我参与的" })).toBeVisible();
  await user.type(screen.getByRole("searchbox"), "拉面");
  expect(screen.getByText("一兰拉面")).toBeVisible();
  expect(onFiltersChange).not.toHaveBeenCalled();
  await user.click(
    within(filterDialog).getByRole("button", { name: "应用筛选" }),
  );
  expect(onFiltersChange).toHaveBeenLastCalledWith({
    query: "拉面",
    category: null,
    mine: false,
  });
});

test("流水消费摘要只显示总消费、笔数和按参与成员计算的人均消费", () => {
  render(
    <ExpenseFeed
      activity={{
        id: "activity-1",
        name: "大阪",
        currency: "CNY",
        totalExpenseMinor: "6000",
        originalCurrencyTotals: [],
        startDate: "2026-08-20",
        endDate: "2026-08-24",
        memberCount: 3,
        expenseCount: 3,
        participatingMemberCount: 4,
        averageExpenseMinor: "1500",
      }}
      timeZone="Asia/Shanghai"
      expenses={[]}
      entryContext={
        {
          activity: { status: "ACTIVE" },
          permissions: { canCreateExpense: false, canManageMembers: false },
        } as never
      }
    />,
  );

  expect(screen.getByRole("banner", { name: "活动信息" })).toHaveTextContent(
    "5天 · 3人 · 进行中",
  );
  expect(screen.getByLabelText("消费摘要")).toHaveTextContent(
    "总消费¥60.003 笔消费 · 人均消费 ¥15.00",
  );
  expect(screen.queryByText("我的结算")).not.toBeInTheDocument();
});

test("消费链接保留所属活动并按发生日期分组", () => {
  render(
    <ExpenseFeed
      activity={{
        id: "activity-1",
        name: "大阪",
        currency: "CNY",
        totalExpenseMinor: "6000",
        originalCurrencyTotals: [],
        startDate: "2026-08-20",
        endDate: "2026-08-24",
        memberCount: 3,
        expenseCount: 2,
        participatingMemberCount: 2,
        averageExpenseMinor: "4000",
      }}
      timeZone="Pacific/Honolulu"
      expenses={[
        {
          id: "expense-1",
          title: "午餐",
          category: "FOOD",
          originalAmountMinor: "6000",
          originalCurrency: "CNY",
          baseAmountMinor: "6000",
          baseCurrency: "CNY",
          occurredAt: "2026-08-23T08:00:00.000Z",
        },
        {
          id: "expense-2",
          title: "早餐",
          category: "FOOD",
          originalAmountMinor: "2000",
          originalCurrency: "CNY",
          baseAmountMinor: "2000",
          baseCurrency: "CNY",
          occurredAt: "2026-08-22T08:00:00.000Z",
        },
      ]}
    />,
  );

  const lunchLink = screen.getByRole("link", { name: /午餐/ });
  expect(lunchLink).toHaveAttribute(
    "href",
    "/activities/activity-1/expenses/expense-1",
  );
  expect(lunchLink.querySelector("svg")).not.toBeNull();
  expect(lunchLink.querySelector("svg")).not.toHaveClass("rounded-full");
  expect(screen.getByRole("list", { name: "2026年8月22日" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "2026年8月21日" })).toBeVisible();
});
