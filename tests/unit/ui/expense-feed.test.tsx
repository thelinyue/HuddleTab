// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
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
        currentUserBalanceMinor: "0",
      }}
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

  expect(screen.getByRole("searchbox", { name: "搜索消费名称" })).toBeVisible();
  expect(screen.getByRole("button", { name: "餐饮" })).toBeVisible();
  expect(screen.getByRole("checkbox", { name: "只看我参与的" })).toBeVisible();
  await user.type(screen.getByRole("searchbox"), "拉面");
  expect(screen.getByText("一兰拉面")).toBeVisible();
});

test("流水消费摘要只展示权威总额派生的人均和当前余额", () => {
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
        currentUserBalanceMinor: "-1200",
      }}
      expenses={[]}
    />,
  );

  expect(screen.getByText("2026-08-20 至 2026-08-24 · 3 人")).toBeVisible();
  expect(screen.getByLabelText("消费摘要")).toHaveTextContent("人均¥20.00");
  expect(screen.getByLabelText("消费摘要")).toHaveTextContent("我的余额¥12.00");
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
        currentUserBalanceMinor: "0",
      }}
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

  expect(screen.getByRole("link", { name: /午餐/ })).toHaveAttribute(
    "href",
    "/activities/activity-1/expenses/expense-1",
  );
  expect(
    screen.getAllByRole("heading", { name: "2026年8月23日" }),
  ).not.toHaveLength(0);
  expect(screen.getByRole("heading", { name: "2026年8月22日" })).toBeVisible();
});
