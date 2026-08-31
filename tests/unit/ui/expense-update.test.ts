import { afterEach, expect, test, vi } from "vitest";

import type { ExpenseDetailResponse } from "@/features/expenses/api";
import {
  buildUpdateExpenseRequest,
  expenseUpdateDraft,
} from "@/features/expenses/components/expense-update";

const data: ExpenseDetailResponse = {
  expense: {
    id: "expense-1",
    activityId: "activity-1",
    title: "晚餐",
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
    version: 7,
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
      originalAmountMinor: "21400",
      baseAmountMinor: "21400",
    },
    {
      memberId: "m2",
      memberDisplayName: "小王",
      splitInputMinor: null,
      originalAmountMinor: "21400",
      baseAmountMinor: "21400",
    },
  ],
  attachments: [],
  permissions: { canUpdate: true, canDelete: false },
};

afterEach(() => vi.restoreAllMocks());

test("单付款金额变化派生付款金额，并保留完整 PUT 事实和版本", () => {
  const draft = expenseUpdateDraft(data, "Asia/Shanghai");
  const request = buildUpdateExpenseRequest(data, {
    ...draft,
    amount: "500.00",
    note: "",
  }, "Asia/Shanghai");

  expect(request).toMatchObject({
    version: 7,
    originalAmountMinor: "50000",
    payments: [{ memberId: "m1", amountMinor: "50000" }],
    split: { mode: "EQUAL", members: ["m1", "m2"] },
  });
  expect(request.note).toBeUndefined();
  expect(request.clientMutationId).toEqual(expect.any(String));
});

test("多人付款和 EXACT 分摊未守恒时阻止完整更新", () => {
  const draft = expenseUpdateDraft(data, "Asia/Shanghai");
  expect(() =>
    buildUpdateExpenseRequest(data, {
      ...draft,
      payerSelection: {
        mode: "multiple",
        memberIds: ["m1", "m2"],
        amountInputs: { m1: "200.00", m2: "200.00" },
      },
      splitMode: "EXACT",
      splitEntries: { m1: "100.00", m2: "100.00" },
    }, "Asia/Shanghai"),
  ).toThrow("付款合计必须等于消费金额");
});

test("编辑表单按部署 TZ 将墙上时间还原为原 UTC 瞬间", () => {
  const draft = expenseUpdateDraft(data, "Pacific/Honolulu");
  const request = buildUpdateExpenseRequest(
    data,
    draft,
    "Pacific/Honolulu",
  );

  expect(draft.occurredAt).toBe("2026-08-26T22:00");
  expect(request.occurredAt).toBe("2026-08-27T08:00:00.000Z");
  expect(request.exchangeRateAt).toBe("2026-08-27T08:00:00.000Z");
});

test.each([
  ["PERCENTAGE", { m1: "25", m2: "75" }, ["2500", "7500"]],
  ["WEIGHT", { m1: "1", m2: "3" }, ["100", "300"]],
] as const)(
  "%s 分摊保留输入并构建完整 entries",
  (mode, splitEntries, values) => {
    const draft = expenseUpdateDraft(data, "Asia/Shanghai");
    const request = buildUpdateExpenseRequest(data, {
      ...draft,
      splitMode: mode,
      splitEntries,
    }, "Asia/Shanghai");
    expect(request.split).toMatchObject({
      mode,
      entries: [
        { memberId: "m1", value: values[0] },
        { memberId: "m2", value: values[1] },
      ],
    });
  },
);
