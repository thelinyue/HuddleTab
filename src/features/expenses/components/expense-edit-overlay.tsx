"use client";

import { ArrowLeftIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { getCurrencyMinorUnits } from "@/domain/currency/currency";
import {
  addGuestMember,
  updateExpense,
  type ExpenseDetailResponse,
  type QuickExpenseContextDto,
} from "@/features/expenses/api";
import type { ExpenseCategory } from "@/features/expenses/categories";
import {
  QuickExpenseForm,
  type QuickExpenseInitialValues,
  type QuickExpenseStep,
} from "@/features/expenses/components/quick-expense-form";
import { ResponsiveFormOverlay } from "@/features/expenses/components/responsive-form-overlay";
import { useOnlineStatus } from "@/features/expenses/components/offline-status";

function amountInput(amountMinor: string, currency: string) {
  const precision = getCurrencyMinorUnits(currency);
  const units = BigInt(amountMinor);
  if (precision === 0) return units.toString();
  const scale = 10n ** BigInt(precision);
  return `${units / scale}.${(units % scale).toString().padStart(precision, "0")}`;
}

function hundredthsInput(value: string | null) {
  const units = BigInt(value ?? "0");
  return `${units / 100n}.${(units % 100n).toString().padStart(2, "0")}`;
}

function dateTimeInput(value: string, timeZone: string) {
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

function initialValues(
  data: ExpenseDetailResponse,
  timeZone: string,
): QuickExpenseInitialValues {
  const { expense } = data;
  const splitMode = ["EQUAL", "EXACT", "PERCENTAGE", "WEIGHT"].includes(
    expense.splitMode,
  )
    ? (expense.splitMode as QuickExpenseInitialValues["splitMode"])
    : "EQUAL";
  const payerIds = data.payments.map((payment) => payment.memberId);
  return {
    amount: amountInput(expense.originalAmountMinor, expense.originalCurrency),
    title: expense.title,
    category: expense.category as ExpenseCategory,
    currency: expense.originalCurrency,
    exchangeRate: expense.exchangeRate,
    exchangeRateSource:
      expense.exchangeRateSource as QuickExpenseInitialValues["exchangeRateSource"],
    exchangeRateAt: dateTimeInput(expense.exchangeRateAt, timeZone),
    occurredAt: dateTimeInput(expense.occurredAt, timeZone),
    note: expense.note ?? "",
    splitMode,
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
        splitMode === "EXACT"
          ? amountInput(
              share.splitInputMinor ?? share.originalAmountMinor,
              expense.originalCurrency,
            )
          : splitMode === "PERCENTAGE" || splitMode === "WEIGHT"
            ? hundredthsInput(share.splitInputMinor)
            : "",
      ]),
    ),
  };
}

/**
 * 编辑复用快速记账的金额、付款人与分摊表单，但提交改走带版本的在线 PUT。
 * 离线 mutation 格式没有更新语义，因此这里明确不把编辑请求塞入创建队列。
 */
export function ExpenseEditOverlay({
  open,
  onOpenChange,
  onSaved,
  data,
  context,
  timeZone,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSaved: () => void;
  readonly data: ExpenseDetailResponse;
  readonly context: QuickExpenseContextDto;
  readonly timeZone: string;
}) {
  const [step, setStep] = useState<QuickExpenseStep>("ENTRY");
  const [splitValid, setSplitValid] = useState(false);
  const online = useOnlineStatus();
  const values = useMemo(() => initialValues(data, timeZone), [data, timeZone]);
  const updateOpen = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setStep("ENTRY");
      setSplitValid(false);
    }
  };

  return (
    <ResponsiveFormOverlay
      open={open}
      onOpenChange={updateOpen}
      title={step === "SPLIT" ? "分摊设置" : "编辑账单"}
      mobileFullScreen
      headerStart={
        step === "SPLIT" ? (
          <button
            type="button"
            aria-label="返回编辑账单"
            onClick={() => setStep("ENTRY")}
            className="inline-flex size-11 items-center justify-center rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <ArrowLeftIcon aria-hidden="true" className="size-5" />
          </button>
        ) : undefined
      }
      headerEnd={
        step === "SPLIT" ? (
          <button
            type="button"
            aria-label="完成"
            disabled={!splitValid}
            onClick={() => setStep("ENTRY")}
            className="type-label inline-flex min-h-11 items-center px-3 font-semibold text-primary disabled:text-muted-foreground"
          >
            完成
          </button>
        ) : undefined
      }
    >
      <QuickExpenseForm
        activity={context.activity}
        members={context.members}
        preference={{
          lastCategory: context.preference
            .lastCategory as ExpenseCategory | null,
          recentParticipantIds: context.preference.recentParticipantIds,
          recentPayerIds: context.preference.recentPayerIds,
          recentCurrency: context.preference.recentCurrency,
          recentTitles: context.preference.recentTitles,
        }}
        online={online}
        canManageMembers={context.permissions.canManageMembers}
        onAddGuest={(displayName) =>
          addGuestMember(context.activity.id, displayName)
        }
        step={step}
        onStepChange={setStep}
        onSplitValidityChange={setSplitValid}
        initialValues={values}
        allowAttachments={false}
        submitLabel="保存修改"
        onConflict={() => {
          updateOpen(false);
          onSaved();
        }}
        submitExpense={(request) =>
          updateExpense(data.expense.activityId, data.expense.id, {
            ...request,
            version: data.expense.version,
          })
        }
        onSaved={() => {
          updateOpen(false);
          onSaved();
        }}
      />
    </ResponsiveFormOverlay>
  );
}
