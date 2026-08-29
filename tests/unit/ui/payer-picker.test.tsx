// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  PayerPicker,
  resolvePayerPayments,
  type PayerSelection,
} from "@/features/expenses/components/payer-picker";

const members = [
  { id: "m1", displayName: "小王", avatarPreset: 5 as const },
  { id: "m2", displayName: "小李", avatarPreset: null },
];

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

test("单付款始终使用当前有效账单总额生成付款事实", () => {
  const selection = { mode: "single", memberId: "m1" } as const;

  expect(resolvePayerPayments(selection, 10_000n, "CNY").payments).toEqual([
    { memberId: "m1", amountMinor: "10000" },
  ]);
  expect(resolvePayerPayments(selection, 12_000n, "CNY").payments).toEqual([
    { memberId: "m1", amountMinor: "12000" },
  ]);
});

test("多人付款严格守恒且账单总额变化后不会自动重分配", () => {
  const selection: PayerSelection = {
    mode: "multiple",
    memberIds: ["m1", "m2"],
    amountInputs: { m1: "60", m2: "40" },
  };

  expect(resolvePayerPayments(selection, 10_000n, "CNY")).toMatchObject({
    payments: [
      { memberId: "m1", amountMinor: "6000" },
      { memberId: "m2", amountMinor: "4000" },
    ],
    allocatedMinor: 10_000n,
    error: null,
  });
  expect(resolvePayerPayments(selection, 12_000n, "CNY")).toMatchObject({
    payments: null,
    allocatedMinor: 10_000n,
    error: "付款合计必须等于消费金额。",
  });
  expect(selection.amountInputs).toEqual({ m1: "60", m2: "40" });
});

test("金额无效时多人付款区域提示先填写金额并禁止完成", async () => {
  const user = userEvent.setup();
  render(
    <PayerPicker
      members={members}
      value={{ mode: "single", memberId: "m1" }}
      onChange={vi.fn()}
      totalMinor={null}
      currency="CNY"
      online
    />,
  );

  await user.click(screen.getByRole("button", { name: "谁付款" }));
  await user.click(screen.getByRole("button", { name: "多人付款" }));

  expect(screen.getByText("先填写账单金额，再分配多人付款金额")).toBeVisible();
  expect(screen.getByRole("button", { name: "完成" })).toBeDisabled();
});

test("多人付款在同一面板选择成员、分配金额并提交", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(
    <PayerPicker
      members={members}
      value={{ mode: "single", memberId: "m1" }}
      onChange={onChange}
      totalMinor={10_000n}
      currency="CNY"
      online
    />,
  );

  await user.click(screen.getByRole("button", { name: "谁付款" }));
  await user.click(screen.getByRole("button", { name: "多人付款" }));
  await user.click(screen.getByRole("checkbox", { name: "小李" }));
  await user.clear(screen.getByRole("textbox", { name: "小王付款金额" }));
  await user.type(screen.getByRole("textbox", { name: "小王付款金额" }), "60");
  await user.type(screen.getByRole("textbox", { name: "小李付款金额" }), "40");

  expect(screen.getByText("已分配").parentElement).toHaveTextContent(
    "已分配¥100.00/¥100.00",
  );
  await user.click(screen.getByRole("button", { name: "完成" }));
  expect(onChange).toHaveBeenCalledWith({
    mode: "multiple",
    memberIds: ["m1", "m2"],
    amountInputs: { m1: "60", m2: "40" },
  });
});
