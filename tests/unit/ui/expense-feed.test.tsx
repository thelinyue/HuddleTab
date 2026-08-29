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
      timeZone="Asia/Shanghai"
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
  expect(foodFilter.querySelector("img")).toHaveAttribute(
    "src",
    "/expense-categories/food.webp",
  );
  expect(foodFilter.querySelector("img")).toHaveClass("rounded-full");
  expect(filterDialog.querySelectorAll("img")).toHaveLength(7);
  expect(screen.getByRole("checkbox", { name: "只看我参与的" })).toBeVisible();
  await user.type(screen.getByRole("searchbox"), "拉面");
  expect(screen.getByText("一兰拉面")).toBeVisible();
});

test.each([
  ["1200", "应收¥12.00"],
  ["-1200", "应付¥12.00"],
  ["0", "已结清¥0.00"],
])("流水消费摘要将本人净余额 %s 显示为 %s", (balance, expected) => {
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
        currentUserBalanceMinor: balance,
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

  expect(screen.getByText("5天 · 3人 · 进行中")).toBeVisible();
  expect(screen.getByLabelText("消费摘要")).toHaveTextContent("人均¥20.00");
  expect(screen.getByLabelText("消费摘要")).toHaveTextContent(
    `我的结算${expected}`,
  );
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
  expect(lunchLink.querySelector("img")).toHaveAttribute(
    "src",
    "/expense-categories/food.webp",
  );
  expect(lunchLink.querySelector("img")).toHaveClass("rounded-full");
  expect(screen.getByRole("list", { name: "2026年8月22日" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "2026年8月21日" })).toBeVisible();
});
