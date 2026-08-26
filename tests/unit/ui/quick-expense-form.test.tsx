// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createExpense: vi.fn() }));

vi.mock("@/features/expenses/api", () => ({
  createExpense: mocks.createExpense,
}));

import { QuickExpenseForm } from "@/features/expenses/components/quick-expense-form";

afterEach(() => {
  cleanup();
  mocks.createExpense.mockReset();
});

const activity = {
  id: "a1",
  baseCurrency: "CNY",
  currentMemberId: "m1",
  currentUserId: "u1",
};
const members = [
  { id: "m1", displayName: "小王", status: "ACTIVE" as const },
  { id: "m2", displayName: "小李", status: "ACTIVE" as const },
];
const preference = {
  lastCategory: "OTHER" as const,
  recentParticipantIds: ["m1", "m2"],
  recentPayerIds: ["m1"],
  recentCurrency: "CNY",
};

test("默认只展示快速字段，展开后提供四种分摊和外币快照", async () => {
  const user = userEvent.setup();
  render(
    <QuickExpenseForm
      activity={activity}
      members={members}
      preference={preference}
      onSaved={vi.fn()}
    />,
  );

  expect(screen.getByLabelText("金额")).toBeVisible();
  expect(screen.getByLabelText("用途")).toBeVisible();
  expect(screen.queryByLabelText("汇率")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "更多设置" }));
  expect(screen.getByRole("radiogroup", { name: "分摊方式" })).toBeVisible();
  expect(screen.getByRole("radio", { name: "均摊" })).toBeChecked();
  expect(screen.getByLabelText("汇率")).toBeVisible();
});

test("多人付款和精确分摊转换为最小金额，并在付款不守恒时阻止保存", async () => {
  const user = userEvent.setup();
  mocks.createExpense.mockResolvedValue({ expense: { id: "expense-1" } });
  render(
    <QuickExpenseForm
      activity={activity}
      members={members}
      preference={preference}
      onSaved={vi.fn()}
    />,
  );

  await user.type(screen.getByLabelText("金额"), "100");
  await user.type(screen.getByLabelText("用途"), "晚餐");
  await user.click(screen.getByRole("button", { name: "更多设置" }));
  await user.click(screen.getByRole("button", { name: "多人付款" }));
  await user.clear(screen.getByLabelText("小王付款金额"));
  await user.type(screen.getByLabelText("小王付款金额"), "60");
  await user.click(screen.getByLabelText("小李作为付款人"));
  await user.type(screen.getByLabelText("小李付款金额"), "30");
  await user.click(screen.getByRole("radio", { name: "按金额" }));
  await user.type(screen.getByLabelText("小王分摊值"), "50");
  await user.type(screen.getByLabelText("小李分摊值"), "50");
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(screen.getByRole("alert")).toHaveTextContent(
    "付款合计必须等于消费金额",
  );
  expect(mocks.createExpense).not.toHaveBeenCalled();
  await user.clear(screen.getByLabelText("小李付款金额"));
  await user.type(screen.getByLabelText("小李付款金额"), "40");
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(mocks.createExpense).toHaveBeenCalledWith(
    "a1",
    expect.objectContaining({
      originalAmountMinor: "10000",
      payments: [
        { memberId: "m1", amountMinor: "6000" },
        { memberId: "m2", amountMinor: "4000" },
      ],
      split: {
        mode: "EXACT",
        entries: [
          { memberId: "m1", value: "5000" },
          { memberId: "m2", value: "5000" },
        ],
      },
    }),
  );
});

test("失败重试复用同一个 clientMutationId，并将校验错误聚焦到摘要", async () => {
  const user = userEvent.setup();
  const onSaved = vi.fn();
  mocks.createExpense
    .mockRejectedValueOnce(new Error("网络连接失败，请重试。"))
    .mockResolvedValueOnce({ expense: { id: "expense-1" } });
  render(
    <QuickExpenseForm
      activity={activity}
      members={members}
      preference={preference}
      onSaved={onSaved}
    />,
  );

  await user.click(screen.getByRole("button", { name: "保存" }));
  const summary = screen.getByRole("alert", { name: "请修正以下问题" });
  expect(summary).toHaveFocus();
  expect(summary).toHaveTextContent("金额不能为空");
  expect(screen.getByRole("link", { name: "金额不能为空。" })).toHaveAttribute(
    "href",
    "#quick-expense-amount",
  );

  await user.type(screen.getByLabelText("金额"), "10");
  await user.type(screen.getByLabelText("用途"), "早餐");
  await user.click(screen.getByRole("button", { name: "保存" }));
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(mocks.createExpense).toHaveBeenCalledTimes(2);
  expect(mocks.createExpense.mock.calls[0]?.[1].clientMutationId).toBe(
    mocks.createExpense.mock.calls[1]?.[1].clientMutationId,
  );
  expect(onSaved).toHaveBeenCalledOnce();
});
