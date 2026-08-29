// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createExpense: vi.fn(),
  deleteExpense: vi.fn(),
  getExpenseDetail: vi.fn(),
  getExpenseFeedSummary: vi.fn(),
  getQuickExpenseContext: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  updateExpense: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ activityId: "activity-1", expenseId: "expense-1" }),
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));

vi.mock("@/features/expenses/api", () => ({
  createExpense: mocks.createExpense,
  deleteExpense: mocks.deleteExpense,
  getExpenseDetail: mocks.getExpenseDetail,
  getExpenseFeedSummary: mocks.getExpenseFeedSummary,
  getQuickExpenseContext: mocks.getQuickExpenseContext,
  updateExpense: mocks.updateExpense,
}));

import { ExpenseDetailLoader } from "@/features/expenses/components/expense-loaders";

const detail = {
  expense: {
    id: "expense-1",
    activityId: "activity-1",
    title: "海底捞火锅",
    category: "FOOD",
    originalAmountMinor: "42800",
    originalCurrency: "CNY",
    baseAmountMinor: "42800",
    baseCurrency: "CNY",
    exchangeRate: "1",
    exchangeRateSource: "IDENTITY",
    exchangeRateAt: "2026-08-27T08:00:00.000Z",
    splitMode: "EQUAL",
    occurredAt: "2026-08-27T08:00:00.000Z",
    note: null,
    createdByMemberId: "m1",
    createdByDisplayName: "我",
    version: 4,
    createdAt: "2026-08-27T08:03:00.000Z",
    updatedAt: "2026-08-27T08:03:00.000Z",
  },
  payments: [
    {
      memberId: "m1",
      memberDisplayName: "我",
      originalAmountMinor: "42800",
      baseAmountMinor: "42800",
    },
  ],
  shares: [
    {
      memberId: "m1",
      memberDisplayName: "我",
      splitInputMinor: null,
      originalAmountMinor: "42800",
      baseAmountMinor: "42800",
    },
  ],
  attachments: [],
  permissions: { canUpdate: true, canDelete: true },
};

const context = {
  activity: {
    id: "activity-1",
    baseCurrency: "CNY",
    status: "ACTIVE",
    currentMemberId: "m1",
    currentUserId: "u1",
  },
  members: [{ id: "m1", displayName: "我", status: "ACTIVE" }],
  preference: {
    lastCategory: null,
    recentParticipantIds: [],
    recentPayerIds: [],
    recentCurrency: null,
    recentTitles: [],
  },
  permissions: { canCreateExpense: true, canManageMembers: false },
};

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  mocks.getExpenseDetail.mockResolvedValue(detail);
  mocks.getExpenseFeedSummary.mockResolvedValue({
    activityName: "日本大阪之旅",
  });
  mocks.getQuickExpenseContext.mockResolvedValue(context);
  mocks.deleteExpense.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

test("详情加载器提供活动名称和真实编辑上下文", async () => {
  const user = userEvent.setup();
  render(<ExpenseDetailLoader timeZone="Asia/Shanghai" />);

  expect(
    await screen.findByRole("heading", { name: "账单详情" }),
  ).toBeVisible();
  expect(mocks.getExpenseFeedSummary).toHaveBeenCalledWith("activity-1");
  expect(mocks.getQuickExpenseContext).toHaveBeenCalledWith("activity-1");
  await user.click(screen.getByRole("button", { name: "账单操作" }));
  await user.click(screen.getByRole("menuitem", { name: "编辑账单" }));
  expect(
    await screen.findByRole("heading", { name: "编辑账单" }),
  ).toBeVisible();
  expect(screen.getByLabelText("金额")).toHaveValue("428.00");
});

test("删除账单携带当前版本并返回活动流水", async () => {
  const user = userEvent.setup();
  render(<ExpenseDetailLoader timeZone="Asia/Shanghai" />);
  await screen.findByRole("heading", { name: "账单详情" });

  await user.click(screen.getByRole("button", { name: "账单操作" }));
  await user.click(screen.getByRole("menuitem", { name: "删除账单" }));
  const dialog = screen.getByRole("alertdialog", { name: "确认删除账单" });
  await user.click(within(dialog).getByRole("button", { name: "确认删除" }));

  expect(mocks.deleteExpense).toHaveBeenCalledWith(
    "activity-1",
    "expense-1",
    4,
  );
  expect(mocks.replace).toHaveBeenCalledWith("/activities/activity-1");
  expect(mocks.refresh).toHaveBeenCalledOnce();
});
