import { z } from "zod";

import { expenseCategories } from "@/features/expenses/categories";

const positiveMinor = z
  .string()
  .regex(/^[1-9]\d*$/, "金额必须是正整数最小单位");
const nonNegativeMinor = z
  .string()
  .regex(/^\d+$/, "金额必须是非负整数最小单位");
const currency = z.string().regex(/^[A-Z]{3}$/, "币种必须是三个大写字母");
const memberId = z.string().min(1);

const payment = z.object({ memberId, amountMinor: positiveMinor });
const split = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("EQUAL"), members: z.array(memberId).min(1) }),
  z.object({
    mode: z.literal("EXACT"),
    entries: z.array(z.object({ memberId, value: nonNegativeMinor })).min(1),
  }),
  z.object({
    mode: z.literal("PERCENTAGE"),
    entries: z.array(z.object({ memberId, value: positiveMinor })).min(1),
  }),
  z.object({
    mode: z.literal("WEIGHT"),
    entries: z.array(z.object({ memberId, value: positiveMinor })).min(1),
  }),
]);

function hasDuplicate(ids: readonly string[]): boolean {
  return new Set(ids).size !== ids.length;
}

/** 仅校验 JSON 边界；换汇、分摊和成员归属仍由纯 Domain 与服务事务重新验证。 */
export const createExpenseInput = z
  .object({
    clientMutationId: z.string().trim().min(1).max(128),
    title: z.string().trim().min(1).max(120),
    category: z.enum(expenseCategories),
    originalCurrency: currency,
    originalAmountMinor: positiveMinor,
    exchangeRate: z.string().trim().min(1).max(64),
    exchangeRateSource: z.enum(["IDENTITY", "PROVIDER", "CACHE", "MANUAL"]),
    exchangeRateAt: z.iso.datetime(),
    occurredAt: z.iso.datetime(),
    note: z.string().trim().max(2000).optional(),
    payments: z.array(payment).min(1),
    split,
  })
  .superRefine((input, context) => {
    if (hasDuplicate(input.payments.map((row) => row.memberId))) {
      context.addIssue({
        code: "custom",
        path: ["payments"],
        message: "付款成员不能重复",
      });
    }
    const participantIds =
      input.split.mode === "EQUAL"
        ? input.split.members
        : input.split.entries.map((row) => row.memberId);
    if (hasDuplicate(participantIds)) {
      context.addIssue({
        code: "custom",
        path: ["split"],
        message: "分摊成员不能重复",
      });
    }
    if (input.split.mode === "PERCENTAGE") {
      const total = input.split.entries.reduce(
        (sum, row) => sum + BigInt(row.value),
        0n,
      );
      if (total !== 10_000n) {
        context.addIssue({
          code: "custom",
          path: ["split"],
          message: "比例合计必须等于 100.00%",
        });
      }
    }
  });
