import { getCurrencyMinorUnits } from "@/domain/currency/currency";
import { splitExpense, type SplitInput } from "@/domain/splitting/split";
import type { AllocationResult } from "@/domain/splitting/allocation";
import type { ExpenseDetailResponse } from "@/features/expenses/api";
import type { ExpenseCategory } from "@/features/expenses/categories";
import type { UpdateExpenseRequest } from "@/features/expenses/contracts";
import type { PayerSelection } from "@/features/expenses/components/payer-picker";
import { resolvePayerPayments } from "@/features/expenses/components/payer-picker";
import { createClientId } from "@/lib/client-id";
import { zonedDateTimeToIso } from "@/lib/time-zone";

export type ExpenseEditTarget =
  | "TITLE"
  | "AMOUNT"
  | "OCCURRED_AT"
  | "CATEGORY"
  | "NOTE"
  | "PAYMENTS"
  | "SPLIT";

export type ExpenseSplitMode = "EQUAL" | "EXACT" | "PERCENTAGE" | "WEIGHT";

export interface ExpenseUpdateDraft {
  readonly title: string;
  readonly category: ExpenseCategory;
  readonly amount: string;
  readonly currency: string;
  readonly exchangeRate: string;
  readonly exchangeRateSource: UpdateExpenseRequest["exchangeRateSource"];
  readonly exchangeRateAt: string;
  readonly occurredAt: string;
  readonly note: string;
  readonly splitMode: ExpenseSplitMode;
  readonly payerSelection: PayerSelection;
  readonly participantIds: readonly string[];
  readonly splitEntries: Readonly<Record<string, string>>;
}

export function amountInput(amountMinor: string, currency: string) {
  const precision = getCurrencyMinorUnits(currency);
  const units = BigInt(amountMinor);
  if (precision === 0) return units.toString();
  const scale = 10n ** BigInt(precision);
  return `${units / scale}.${(units % scale).toString().padStart(precision, "0")}`;
}

export function hundredthsInput(value: string | null) {
  const units = BigInt(value ?? "0");
  return `${units / 100n}.${(units % 100n).toString().padStart(2, "0")}`;
}

export function dateTimeInput(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function splitMode(value: string): ExpenseSplitMode {
  return ["EQUAL", "EXACT", "PERCENTAGE", "WEIGHT"].includes(value)
    ? (value as ExpenseSplitMode)
    : "EQUAL";
}

/** 以详情接口事实构建一次编辑会话的完整草稿，不从摘要推测付款或分摊。 */
export function expenseUpdateDraft(
  data: ExpenseDetailResponse,
  timeZone: string,
): ExpenseUpdateDraft {
  const { expense } = data;
  const mode = splitMode(expense.splitMode);
  const payerIds = data.payments.map((payment) => payment.memberId);
  return {
    title: expense.title,
    category: expense.category as ExpenseCategory,
    amount: amountInput(expense.originalAmountMinor, expense.originalCurrency),
    currency: expense.originalCurrency,
    exchangeRate: expense.exchangeRate,
    exchangeRateSource:
      expense.exchangeRateSource as ExpenseUpdateDraft["exchangeRateSource"],
    exchangeRateAt: dateTimeInput(expense.exchangeRateAt, timeZone),
    occurredAt: dateTimeInput(expense.occurredAt, timeZone),
    note: expense.note ?? "",
    splitMode: mode,
    payerSelection:
      data.payments.length <= 1
        ? { mode: "single", memberId: payerIds[0] ?? "" }
        : {
            mode: "multiple",
            memberIds: payerIds,
            amountInputs: Object.fromEntries(
              data.payments.map((payment) => [
                payment.memberId,
                amountInput(
                  payment.originalAmountMinor,
                  expense.originalCurrency,
                ),
              ]),
            ),
          },
    participantIds: data.shares.map((share) => share.memberId),
    splitEntries: Object.fromEntries(
      data.shares.map((share) => [
        share.memberId,
        mode === "EXACT"
          ? amountInput(
              share.splitInputMinor ?? share.originalAmountMinor,
              expense.originalCurrency,
            )
          : mode === "PERCENTAGE" || mode === "WEIGHT"
            ? hundredthsInput(share.splitInputMinor)
            : "",
      ]),
    ),
  };
}

export function amountToMinor(value: string, currency: string): string {
  const precision = getCurrencyMinorUnits(currency.trim().toUpperCase());
  const match = value.trim().match(/^(0|[1-9]\d*)(?:\.(\d+))?$/);
  if (!match) throw new Error("金额格式不正确。");
  if ((match[2]?.length ?? 0) > precision) {
    throw new Error("金额小数位超过币种精度。");
  }
  const fraction = (match[2] ?? "").padEnd(precision, "0");
  const minor =
    BigInt(match[1]) * 10n ** BigInt(precision) + BigInt(fraction || "0");
  if (minor <= 0n) throw new Error("金额必须大于 0。");
  return minor.toString();
}

function decimalToHundredths(value: string, label: string): string {
  const match = value.trim().match(/^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/);
  if (!match) throw new Error(`${label}格式不正确。`);
  return (
    BigInt(match[1]) * 100n +
    BigInt((match[2] ?? "").padEnd(2, "0"))
  ).toString();
}

function buildSplit(
  draft: ExpenseUpdateDraft,
  totalMinor: bigint,
): UpdateExpenseRequest["split"] {
  if (!draft.participantIds.length) throw new Error("至少选择一名参与成员。");
  if (draft.splitMode === "EQUAL") {
    splitExpense({
      mode: "EQUAL",
      totalMinor,
      memberIds: draft.participantIds,
    });
    return { mode: "EQUAL", members: draft.participantIds };
  }
  const input: SplitInput =
    draft.splitMode === "EXACT"
      ? {
          mode: "EXACT",
          totalMinor,
          shares: draft.participantIds.map((memberId) => ({
            memberId,
            amountMinor: BigInt(
              amountToMinor(draft.splitEntries[memberId] ?? "", draft.currency),
            ),
          })),
        }
      : draft.splitMode === "PERCENTAGE"
        ? {
            mode: "PERCENTAGE",
            totalMinor,
            shares: draft.participantIds.map((memberId) => ({
              memberId,
              basisPoints: BigInt(
                decimalToHundredths(draft.splitEntries[memberId] ?? "", "比例"),
              ),
            })),
          }
        : {
            mode: "WEIGHT",
            totalMinor,
            shares: draft.participantIds.map((memberId) => ({
              memberId,
              weightHundredths: BigInt(
                decimalToHundredths(draft.splitEntries[memberId] ?? "", "权重"),
              ),
            })),
          };
  splitExpense(input);
  return {
    mode: draft.splitMode,
    entries: draft.participantIds.map((memberId) => ({
      memberId,
      value:
        draft.splitMode === "EXACT"
          ? amountToMinor(draft.splitEntries[memberId] ?? "", draft.currency)
          : decimalToHundredths(
              draft.splitEntries[memberId] ?? "",
              draft.splitMode === "PERCENTAGE" ? "比例" : "权重",
            ),
    })),
  };
}

/** 编辑器用于即时展示分摊结果；非法输入返回 null，由界面阻止完成。 */
export function previewExpenseSplit(
  draft: ExpenseUpdateDraft,
): readonly AllocationResult[] | null {
  try {
    const totalMinor = BigInt(amountToMinor(draft.amount, draft.currency));
    if (draft.splitMode === "EQUAL") {
      return splitExpense({
        mode: "EQUAL",
        totalMinor,
        memberIds: draft.participantIds,
      });
    }
    const input: SplitInput =
      draft.splitMode === "EXACT"
        ? {
            mode: "EXACT",
            totalMinor,
            shares: draft.participantIds.map((memberId) => ({
              memberId,
              amountMinor: BigInt(
                amountToMinor(
                  draft.splitEntries[memberId] ?? "",
                  draft.currency,
                ),
              ),
            })),
          }
        : draft.splitMode === "PERCENTAGE"
          ? {
              mode: "PERCENTAGE",
              totalMinor,
              shares: draft.participantIds.map((memberId) => ({
                memberId,
                basisPoints: BigInt(
                  decimalToHundredths(
                    draft.splitEntries[memberId] ?? "",
                    "比例",
                  ),
                ),
              })),
            }
          : {
              mode: "WEIGHT",
              totalMinor,
              shares: draft.participantIds.map((memberId) => ({
                memberId,
                weightHundredths: BigInt(
                  decimalToHundredths(
                    draft.splitEntries[memberId] ?? "",
                    "权重",
                  ),
                ),
              })),
            };
    return splitExpense(input);
  } catch {
    return null;
  }
}

/**
 * 所有分字段编辑最终都从当前草稿生成完整 PUT 请求，确保服务端可以一次性校验
 * 金额、付款、分摊和版本；每次发送都会生成新的客户端 mutation ID。
 */
export function buildUpdateExpenseRequest(
  data: ExpenseDetailResponse,
  draft: ExpenseUpdateDraft,
  timeZone: string,
): UpdateExpenseRequest {
  const currency = draft.currency.trim().toUpperCase();
  const originalAmountMinor = amountToMinor(draft.amount, currency);
  const totalMinor = BigInt(originalAmountMinor);
  const paymentResolution = resolvePayerPayments(
    draft.payerSelection,
    totalMinor,
    currency,
  );
  if (!paymentResolution.payments) {
    throw new Error(paymentResolution.error ?? "付款信息不完整。");
  }
  const exchangeRateAt = zonedDateTimeToIso(draft.exchangeRateAt, timeZone);
  const occurredAt = zonedDateTimeToIso(draft.occurredAt, timeZone);
  const title = draft.title.trim();
  if (!title) throw new Error("用途不能为空。");
  if (title.length > 120) throw new Error("用途最多 120 个字符。");
  if (draft.note.length > 2000) throw new Error("备注最多 2000 个字符。");
  if (!draft.exchangeRate.trim()) throw new Error("汇率不能为空。");
  return {
    clientMutationId: createClientId(),
    version: data.expense.version,
    title,
    category: draft.category,
    originalCurrency: currency,
    originalAmountMinor,
    exchangeRate: draft.exchangeRate.trim(),
    exchangeRateSource:
      currency === data.expense.baseCurrency
        ? "IDENTITY"
        : draft.exchangeRateSource,
    exchangeRateAt,
    occurredAt,
    note: draft.note.trim() || undefined,
    payments: paymentResolution.payments,
    split: buildSplit(draft, totalMinor),
  };
}
