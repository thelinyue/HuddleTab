// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createExpense: vi.fn(),
  updateExpense: vi.fn(),
}));

vi.mock("@/features/expenses/api", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/features/expenses/api")>();
  return {
    ...original,
    createExpense: mocks.createExpense,
    updateExpense: mocks.updateExpense,
  };
});

import {
  ExpenseRequestError,
  type ExpenseDetailResponse,
  type QuickExpenseContextDto,
} from "@/features/expenses/api";
import { ExpenseEditOverlay } from "@/features/expenses/components/expense-edit-overlay";

const context = {
  activity: {
    id: "activity-1",
    baseCurrency: "CNY",
    status: "ACTIVE",
    currentMemberId: "m1",
    currentUserId: "u1",
  },
  members: [
    { id: "m1", displayName: "我", status: "ACTIVE" },
    { id: "m2", displayName: "小王", status: "ACTIVE" },
  ],
  preference: {
    lastCategory: null,
    recentParticipantIds: [],
    recentPayerIds: [],
    recentCurrency: null,
    recentTitles: [],
  },
  permissions: { canCreateExpense: true },
} satisfies QuickExpenseContextDto;

const data = {
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
    splitMode: "PERCENTAGE",
    occurredAt: "2026-08-27T08:00:00.000Z",
    note: "朋友聚餐",
    createdByMemberId: "m1",
    createdByDisplayName: "我",
    version: 3,
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
      splitInputMinor: "2500",
      originalAmountMinor: "10700",
      baseAmountMinor: "10700",
    },
    {
      memberId: "m2",
      memberDisplayName: "小王",
      splitInputMinor: "7500",
      originalAmountMinor: "32100",
      baseAmountMinor: "32100",
    },
  ],
  attachments: [],
  permissions: { canUpdate: true, canDelete: true },
} satisfies ExpenseDetailResponse;

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  mocks.updateExpense.mockResolvedValue({
    id: "expense-1",
    title: "海底捞火锅",
    baseAmountMinor: "42800",
    baseCurrency: "CNY",
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

test("编辑账单使用现有事实预填，并携带版本提交更新", async () => {
  const user = userEvent.setup();
  const onSaved = vi.fn();
  render(
    <ExpenseEditOverlay
      open
      onOpenChange={vi.fn()}
      onSaved={onSaved}
      timeZone="Asia/Shanghai"
      context={context}
      data={data}
    />,
  );

  expect(
    await screen.findByRole("heading", { name: "编辑账单" }),
  ).toBeVisible();
  expect(screen.getByLabelText("金额")).toHaveValue("428.00");
  expect(screen.getByLabelText("用途")).toHaveValue("海底捞火锅");
  await user.click(screen.getByRole("button", { name: "保存修改" }));

  expect(mocks.updateExpense).toHaveBeenCalledWith(
    "activity-1",
    "expense-1",
    expect.objectContaining({
      version: 3,
      originalAmountMinor: "42800",
      split: {
        mode: "PERCENTAGE",
        entries: [
          { memberId: "m1", value: "2500" },
          { memberId: "m2", value: "7500" },
        ],
      },
    }),
  );
  expect(onSaved).toHaveBeenCalledOnce();
  expect(mocks.createExpense).not.toHaveBeenCalled();
});

test("版本冲突时保留用户输入，并可退出编辑查看最新内容", async () => {
  const user = userEvent.setup();
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  mocks.updateExpense.mockRejectedValueOnce(
    new ExpenseRequestError("账单版本冲突。", 409),
  );
  render(
    <ExpenseEditOverlay
      open
      onOpenChange={onOpenChange}
      onSaved={onSaved}
      timeZone="Asia/Shanghai"
      context={context}
      data={data}
    />,
  );

  const title = await screen.findByLabelText("用途");
  await user.clear(title);
  await user.type(title, "修改后的聚餐");
  await user.click(screen.getByRole("button", { name: "保存修改" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("当前输入已保留");
  expect(title).toHaveValue("修改后的聚餐");
  await user.click(screen.getByRole("button", { name: "查看最新内容" }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(onSaved).toHaveBeenCalledOnce();
});
