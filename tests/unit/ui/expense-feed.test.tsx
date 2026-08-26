// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";

import { ExpenseFeed } from "@/features/expenses/components/expense-feed";

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
