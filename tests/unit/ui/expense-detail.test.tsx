// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { ExpenseDetail } from "@/features/expenses/components/expense-detail";

test("消费详情以最小单位合并成员付款和承担，并展示净额", () => {
  render(
    <ExpenseDetail
      data={{
        expense: {
          id: "expense-1",
          activityId: "activity-1",
          title: "晚餐",
          category: "FOOD",
          originalAmountMinor: "150",
          originalCurrency: "CNY",
          baseAmountMinor: "150",
          baseCurrency: "CNY",
          exchangeRate: "1",
          exchangeRateSource: "IDENTITY",
          exchangeRateAt: "2026-08-27T08:00:00.000Z",
          splitMode: "EXACT",
          occurredAt: "2026-08-27T08:00:00.000Z",
          note: null,
          createdByDisplayName: "小王",
          createdAt: "2026-08-27T08:00:00.000Z",
          updatedAt: "2026-08-27T08:00:00.000Z",
        },
        payments: [
          {
            memberId: "m1",
            memberDisplayName: "小王",
            originalAmountMinor: "100",
            baseAmountMinor: "100",
          },
          {
            memberId: "m3",
            memberDisplayName: "小陈",
            originalAmountMinor: "50",
            baseAmountMinor: "50",
          },
        ],
        shares: [
          {
            memberId: "m1",
            memberDisplayName: "小王",
            originalAmountMinor: "25",
            baseAmountMinor: "25",
          },
          {
            memberId: "m2",
            memberDisplayName: "小李",
            originalAmountMinor: "75",
            baseAmountMinor: "75",
          },
          {
            memberId: "m3",
            memberDisplayName: "小陈",
            originalAmountMinor: "50",
            baseAmountMinor: "50",
          },
        ],
        attachments: [],
        permissions: { canUpdate: false, canDelete: false },
      }}
    />,
  );

  const memberSummary = screen.getByRole("region", { name: "成员收支" });
  expect(memberSummary).toHaveTextContent("小王已付¥1.00承担¥0.25净额¥0.75");
  expect(memberSummary).toHaveTextContent("小李已付¥0.00承担¥0.75净额-¥0.75");
  expect(memberSummary).toHaveTextContent("小陈已付¥0.50承担¥0.50净额¥0.00");
  expect(screen.queryByText("此消费可由你管理。")).not.toBeInTheDocument();
});
