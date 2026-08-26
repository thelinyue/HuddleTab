import { getCurrencyMinorUnits } from "@/domain/currency/currency";
import {
  convertMinorAmount,
  parseDecimalRate,
} from "@/domain/exchange-rate/decimal-rate";
import { allocateByWeights } from "@/domain/splitting/allocation";
import { splitExpense } from "@/domain/splitting/split";

type ExpenseSplit =
  | { readonly mode: "EQUAL"; readonly members: readonly string[] }
  | {
      readonly mode: "EXACT" | "PERCENTAGE" | "WEIGHT";
      readonly entries: readonly {
        readonly memberId: string;
        readonly value: bigint;
      }[];
    };

export interface PrepareExpenseInput {
  readonly originalCurrency: string;
  readonly baseCurrency: string;
  readonly originalAmountMinor: bigint;
  readonly exchangeRate: string;
  readonly payments: readonly {
    readonly memberId: string;
    readonly amountMinor: bigint;
  }[];
  readonly split: ExpenseSplit;
}

function allocateBaseAmount(
  total: bigint,
  originals: readonly { memberId: string; amountMinor: bigint }[],
) {
  const positive = originals.filter((row) => row.amountMinor > 0n);
  const allocated = allocateByWeights(
    total,
    positive.map((row) => ({
      memberId: row.memberId,
      weight: row.amountMinor,
    })),
  );
  const byMember = new Map(
    allocated.map((row) => [row.memberId, row.amountMinor]),
  );
  return originals.map((row) => ({
    memberId: row.memberId,
    amountMinor: byMember.get(row.memberId) ?? 0n,
  }));
}

/**
 * 将用户输入收敛为可持久化的 Expense 事实。主币总额只换算一次，Payment 和
 * Share 再按稳定 ActivityMember ID 分配，避免逐行换算造成最小单位的漂移。
 */
export function prepareExpense(input: PrepareExpenseInput) {
  const paymentTotal = input.payments.reduce(
    (sum, row) => sum + row.amountMinor,
    0n,
  );
  if (paymentTotal !== input.originalAmountMinor) {
    throw new Error("付款合计必须等于消费金额");
  }
  const rate = parseDecimalRate(input.exchangeRate);
  const baseAmountMinor = convertMinorAmount(
    input.originalAmountMinor,
    getCurrencyMinorUnits(input.originalCurrency),
    getCurrencyMinorUnits(input.baseCurrency),
    rate,
  );
  const sharesOriginal =
    input.split.mode === "EQUAL"
      ? splitExpense({
          mode: "EQUAL",
          totalMinor: input.originalAmountMinor,
          memberIds: input.split.members,
        })
      : input.split.mode === "EXACT"
        ? splitExpense({
            mode: "EXACT",
            totalMinor: input.originalAmountMinor,
            shares: input.split.entries.map((entry) => ({
              memberId: entry.memberId,
              amountMinor: entry.value,
            })),
          })
        : input.split.mode === "PERCENTAGE"
          ? splitExpense({
              mode: "PERCENTAGE",
              totalMinor: input.originalAmountMinor,
              shares: input.split.entries.map((entry) => ({
                memberId: entry.memberId,
                basisPoints: entry.value,
              })),
            })
          : splitExpense({
              mode: "WEIGHT",
              totalMinor: input.originalAmountMinor,
              shares: input.split.entries.map((entry) => ({
                memberId: entry.memberId,
                weightHundredths: entry.value,
              })),
            });
  const paymentBase = allocateBaseAmount(
    baseAmountMinor,
    input.payments.map((row) => ({
      memberId: row.memberId,
      amountMinor: row.amountMinor,
    })),
  );
  const shareBase = allocateBaseAmount(baseAmountMinor, sharesOriginal);
  const paymentOriginalByMember = new Map(
    input.payments.map((row) => [row.memberId, row.amountMinor]),
  );
  const splitInputByMember = new Map(
    input.split.mode === "EQUAL"
      ? []
      : input.split.entries.map((entry) => [entry.memberId, entry.value]),
  );
  const payments = paymentBase.map((row) => ({
    memberId: row.memberId,
    originalAmountMinor: paymentOriginalByMember.get(row.memberId)!,
    baseAmountMinor: row.amountMinor,
  }));
  const shares = shareBase.map((row) => {
    const original = sharesOriginal.find(
      (share) => share.memberId === row.memberId,
    )!;
    return {
      memberId: row.memberId,
      splitInputMinor:
        input.split.mode === "EQUAL"
          ? null
          : (splitInputByMember.get(row.memberId) ?? null),
      originalAmountMinor: original.amountMinor,
      baseAmountMinor: row.amountMinor,
    };
  });
  if (!shares.some((row) => row.originalAmountMinor > 0n)) {
    throw new Error("至少一名成员必须承担大于零的金额");
  }
  return { baseAmountMinor, payments, shares };
}
