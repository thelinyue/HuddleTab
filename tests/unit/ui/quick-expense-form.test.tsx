// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createExpense: vi.fn() }));

vi.mock("@/features/expenses/api", () => ({
  createExpense: mocks.createExpense,
}));

import { QuickExpenseForm } from "@/features/expenses/components/quick-expense-form";

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  cleanup();
  mocks.createExpense.mockReset();
  vi.unstubAllGlobals();
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

test("分摊设置在同一表单内前进和返回，并保留快速录入值", async () => {
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
  await user.type(screen.getByLabelText("金额"), "88.5");
  await user.type(screen.getByLabelText("用途"), "晚餐");
  await user.click(screen.getByRole("button", { name: "分摊设置" }));
  expect(screen.getByRole("radiogroup", { name: "分摊方式" })).toBeVisible();
  expect(screen.getByRole("radio", { name: "均摊" })).toBeChecked();
  await user.click(screen.getByRole("button", { name: "返回快速记账" }));
  expect(screen.getByLabelText("金额")).toHaveValue("88.5");
  expect(screen.getByLabelText("用途")).toHaveValue("晚餐");
  await user.click(screen.getByRole("button", { name: "更多设置" }));
  expect(screen.getByLabelText("汇率")).toBeVisible();
});

test("分摊设置完成后可直接保存，无需返回快速记账", async () => {
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

  await user.type(screen.getByLabelText("金额"), "88.5");
  await user.type(screen.getByLabelText("用途"), "晚餐");
  await user.click(screen.getByRole("button", { name: "分摊设置" }));
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(mocks.createExpense).toHaveBeenCalledWith(
    "a1",
    expect.objectContaining({
      originalAmountMinor: "8850",
      split: { mode: "EQUAL", members: ["m1", "m2"] },
    }),
  );
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
  await user.click(screen.getByRole("button", { name: "分摊设置" }));
  await user.click(screen.getByRole("radio", { name: "按金额" }));
  await user.type(screen.getByLabelText("小王分摊值"), "50");
  await user.type(screen.getByLabelText("小李分摊值"), "50");
  await user.click(screen.getByRole("button", { name: "返回快速记账" }));
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

test.each([
  {
    label: "均摊",
    expected: { mode: "EQUAL", members: ["m1", "m2"] },
    values: [],
  },
  {
    label: "按金额",
    expected: {
      mode: "EXACT",
      entries: [
        { memberId: "m1", value: "5000" },
        { memberId: "m2", value: "5000" },
      ],
    },
    values: ["50", "50"],
  },
  {
    label: "按比例",
    expected: {
      mode: "PERCENTAGE",
      entries: [
        { memberId: "m1", value: "5000" },
        { memberId: "m2", value: "5000" },
      ],
    },
    values: ["50", "50"],
  },
  {
    label: "按份数",
    expected: {
      mode: "WEIGHT",
      entries: [
        { memberId: "m1", value: "100" },
        { memberId: "m2", value: "300" },
      ],
    },
    values: ["1", "3"],
  },
])("$label 分摊保留现有请求形状", async ({ label, expected, values }) => {
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
  await user.type(screen.getByLabelText("用途"), "分摊测试");
  await user.click(screen.getByRole("button", { name: "分摊设置" }));
  await user.click(screen.getByRole("radio", { name: label }));
  for (const [index, value] of values.entries()) {
    const member = members[index]!;
    await user.type(
      screen.getByLabelText(`${member.displayName}分摊值`),
      value,
    );
  }
  await user.click(screen.getByRole("button", { name: "返回快速记账" }));
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(mocks.createExpense).toHaveBeenCalledWith(
    "a1",
    expect.objectContaining({ split: expected }),
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
