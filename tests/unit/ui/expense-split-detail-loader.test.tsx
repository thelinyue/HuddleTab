// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getExpenseDetail: vi.fn(),
  getExpenseFeedSummary: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ activityId: "activity-1", expenseId: "expense-1" }),
}));

vi.mock("@/features/expenses/api", () => ({
  getExpenseDetail: mocks.getExpenseDetail,
  getExpenseFeedSummary: mocks.getExpenseFeedSummary,
}));

import { ExpenseSplitDetailLoader } from "@/features/expenses/components/expense-loaders";

beforeEach(() => {
  mocks.getExpenseDetail.mockResolvedValue({
    expense: {
      id: "expense-1",
      activityId: "activity-1",
      title: "关西烤肉",
      category: "FOOD",
      originalAmountMinor: "60000",
      originalCurrency: "CNY",
      baseAmountMinor: "60000",
      baseCurrency: "CNY",
      exchangeRate: "1",
      exchangeRateSource: "IDENTITY",
      exchangeRateAt: "2026-08-27T08:00:00.000Z",
      splitMode: "PERCENTAGE",
      occurredAt: "2026-08-27T08:00:00.000Z",
      note: null,
      createdByDisplayName: "我",
      version: 1,
      createdAt: "2026-08-27T08:03:00.000Z",
      updatedAt: "2026-08-27T08:03:00.000Z",
    },
    payments: [
      {
        memberId: "m1",
        memberDisplayName: "我",
        originalAmountMinor: "60000",
        baseAmountMinor: "60000",
      },
    ],
    shares: [
      {
        memberId: "m1",
        memberDisplayName: "我",
        splitInputMinor: "10000",
        originalAmountMinor: "60000",
        baseAmountMinor: "60000",
      },
    ],
    attachments: [],
    permissions: { canUpdate: false, canDelete: false },
  });
  mocks.getExpenseFeedSummary.mockResolvedValue({
    activityName: "日本大阪之旅",
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("分摊明细加载器复用账单详情与活动摘要接口", async () => {
  render(<ExpenseSplitDetailLoader />);

  expect(
    await screen.findByRole("heading", { name: "分摊明细" }),
  ).toBeVisible();
  expect(screen.getByText("日本大阪之旅 · 餐饮")).toBeVisible();
  expect(mocks.getExpenseDetail).toHaveBeenCalledWith(
    "activity-1",
    "expense-1",
  );
  expect(mocks.getExpenseFeedSummary).toHaveBeenCalledWith("activity-1");
});
