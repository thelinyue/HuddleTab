"use client";

import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { getCurrencyMinorUnits } from "@/domain/currency/currency";
import { createExpense } from "@/features/expenses/api";
import {
  expenseCategories,
  expenseCategoryLabels,
  type ExpenseCategory,
} from "@/features/expenses/categories";
import { PaymentEditor } from "@/features/expenses/components/payment-editor";
import { SplitEditor } from "@/features/expenses/components/split-editor";
import type { CreateExpenseRequest } from "@/features/expenses/contracts";
import { enqueueExpense } from "@/pwa/sync-queue/enqueue-expense";

type SplitMode = "EQUAL" | "EXACT" | "PERCENTAGE" | "WEIGHT";
type FormValues = {
  amount: string;
  title: string;
  category: ExpenseCategory;
  currency: string;
  exchangeRate: string;
  exchangeRateSource: "IDENTITY" | "MANUAL";
  exchangeRateAt: string;
  occurredAt: string;
  note: string;
  splitMode: SplitMode;
  payerId: string;
  participantIds: string[];
  payerIds: string[];
  paymentEntries: Record<string, string>;
  splitEntries: Record<string, string>;
};

function amountToMinor(value: string, currency: string): string {
  const precision = getCurrencyMinorUnits(currency.trim().toUpperCase());
  const match = value.trim().match(/^(0|[1-9]\d*)(?:\.(\d+))?$/);
  if (!match) throw new Error("金额格式不正确。");
  const fraction = match[2] ?? "";
  if (fraction.length > precision) throw new Error("金额小数位超过币种精度。");
  const minor =
    BigInt(match[1]) * 10n ** BigInt(precision) +
    BigInt((fraction + "0".repeat(precision)).slice(0, precision) || "0");
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

function currentLocalDateTime(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

export interface QuickExpenseMember {
  readonly id: string;
  readonly displayName: string;
  readonly status: "ACTIVE" | "LEFT";
}
export interface QuickExpensePreference {
  readonly lastCategory?: ExpenseCategory | null;
  readonly recentParticipantIds: readonly string[];
  readonly recentPayerIds: readonly string[];
  readonly recentCurrency?: string | null;
  readonly recentTitles?: readonly string[];
}

/**
 * 快速记账只负责把可读输入转换成严格账务契约。提交后服务端仍根据最新成员、
 * 生命周期、金额守恒和分摊规则复验，客户端默认值绝不成为账务权威。
 */
export function QuickExpenseForm({
  activity,
  members,
  preference,
  online = true,
  onSaved,
  onQueued,
}: {
  readonly activity: {
    readonly id: string;
    readonly baseCurrency: string;
    readonly currentMemberId: string;
    readonly currentUserId: string;
  };
  readonly members: readonly QuickExpenseMember[];
  readonly preference: QuickExpensePreference;
  readonly online?: boolean;
  readonly onSaved: (expense: {
    readonly id: string;
    readonly title: string;
    readonly baseAmountMinor?: string;
    readonly baseCurrency?: string;
  }) => void;
  readonly onQueued?: (mutationId: string) => void;
}) {
  const [advanced, setAdvanced] = useState(false);
  const [multiplePayers, setMultiplePayers] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [queuedMessage, setQueuedMessage] = useState<string | null>(null);
  const [files, setFiles] = useState<readonly File[]>([]);
  const [clientMutationId] = useState(() => crypto.randomUUID());
  const activeMembers = members.filter((member) => member.status === "ACTIVE");
  const preferredParticipants = preference.recentParticipantIds.filter((id) =>
    activeMembers.some((member) => member.id === id),
  );
  const preferredPayerIds = preference.recentPayerIds.filter((id) =>
    activeMembers.some((member) => member.id === id),
  );
  const preferredPayer = preferredPayerIds[0] ?? activity.currentMemberId;
  const form = useForm<FormValues>({
    defaultValues: {
      amount: "",
      title: "",
      category: preference.lastCategory ?? "OTHER",
      currency: preference.recentCurrency ?? activity.baseCurrency,
      exchangeRate: "1",
      exchangeRateSource: "IDENTITY",
      exchangeRateAt: currentLocalDateTime(),
      occurredAt: currentLocalDateTime(),
      note: "",
      splitMode: "EQUAL",
      payerId: preferredPayer,
      participantIds: preferredParticipants.length
        ? preferredParticipants
        : activeMembers.map((member) => member.id),
      payerIds: preferredPayerIds.length ? preferredPayerIds : [preferredPayer],
      paymentEntries: {},
      splitEntries: {},
    },
  });
  const values = useWatch({ control: form.control }) as FormValues;
  useEffect(() => {
    if (submitError)
      document.getElementById("quick-expense-error-summary")?.focus();
  }, [submitError]);
  const showError = (message: string, fieldId?: string) => {
    setSubmitError(message);
    setFieldErrors(fieldId ? { [fieldId]: message } : {});
  };
  async function submit(next: FormValues) {
    setSubmitError(null);
    setFieldErrors({});
    setQueuedMessage(null);
    try {
      if (!next.amount.trim())
        return showError("金额不能为空。", "quick-expense-amount");
      if (!next.title.trim())
        return showError("用途不能为空。", "quick-expense-title");
      if (!next.participantIds.length)
        return showError(
          "至少选择一名参与成员。",
          "quick-expense-participants",
        );
      const currency = next.currency.trim().toUpperCase();
      const amountMinor = amountToMinor(next.amount, currency);
      if (!next.exchangeRate.trim()) throw new Error("汇率不能为空。");
      const payments = multiplePayers
        ? next.payerIds.map((memberId) => ({
            memberId,
            amountMinor: amountToMinor(
              next.paymentEntries[memberId] ?? "",
              currency,
            ),
          }))
        : [{ memberId: next.payerId, amountMinor }];
      if (!payments.length) throw new Error("至少选择一名付款人。");
      if (
        payments.reduce(
          (sum, payment) => sum + BigInt(payment.amountMinor),
          0n,
        ) !== BigInt(amountMinor)
      )
        throw new Error("付款合计必须等于消费金额。");
      const split =
        next.splitMode === "EQUAL"
          ? { mode: "EQUAL" as const, members: next.participantIds }
          : ({
              mode: next.splitMode,
              entries: next.participantIds.map((memberId) => ({
                memberId,
                value:
                  next.splitMode === "EXACT"
                    ? amountToMinor(next.splitEntries[memberId] ?? "", currency)
                    : decimalToHundredths(
                        next.splitEntries[memberId] ?? "",
                        next.splitMode === "PERCENTAGE" ? "比例" : "权重",
                      ),
              })),
            } as const);
      const exchangeRateAt = new Date(next.exchangeRateAt);
      const occurredAt = new Date(next.occurredAt);
      if (Number.isNaN(exchangeRateAt.valueOf()))
        throw new Error("汇率时间格式不正确。");
      if (Number.isNaN(occurredAt.valueOf()))
        throw new Error("消费时间格式不正确。");
      const request: CreateExpenseRequest = {
        clientMutationId,
        title: next.title.trim(),
        category: next.category,
        originalCurrency: currency,
        originalAmountMinor: amountMinor,
        exchangeRate: next.exchangeRate.trim(),
        exchangeRateSource:
          currency === activity.baseCurrency
            ? "IDENTITY"
            : next.exchangeRateSource,
        exchangeRateAt: exchangeRateAt.toISOString(),
        occurredAt: occurredAt.toISOString(),
        note: next.note.trim() || undefined,
        payments,
        split,
      };
      if (!online) {
        await queueExpense(request);
        return;
      }
      try {
        const result = await createExpense(activity.id, request);
        onSaved(result.expense);
      } catch (error) {
        if (error instanceof TypeError) {
          await queueExpense(request);
          return;
        }
        throw error;
      }
    } catch (error) {
      showError(
        error instanceof Error ? error.message : "消费保存失败，请稍后重试。",
      );
    }
  }
  async function queueExpense(request: CreateExpenseRequest) {
    const queued = await enqueueExpense({
      userId: activity.currentUserId,
      activityId: activity.id,
      baseCurrency: activity.baseCurrency,
      input: request,
      files,
    });
    setQueuedMessage("已保存到本机，联网后自动同步。");
    onQueued?.(queued.mutation.id);
  }
  const textInput = "mt-1 min-h-11 w-full border bg-background px-3";
  return (
    <form onSubmit={form.handleSubmit(submit)} className="space-y-5" noValidate>
      {submitError && (
        <div
          id="quick-expense-error-summary"
          role="alert"
          aria-label="请修正以下问题"
          tabIndex={-1}
          className="border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <strong>请修正以下问题</strong>
          {Object.keys(fieldErrors).length ? (
            <ul className="mt-1 list-inside list-disc">
              {Object.entries(fieldErrors).map(([fieldId, message]) => (
                <li key={fieldId}>
                  <a href={`#${fieldId}`} className="underline">
                    {message}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1">{submitError}</p>
          )}
        </div>
      )}
      <div>
        <label
          htmlFor="quick-expense-amount"
          className="block text-sm font-medium"
        >
          金额
        </label>
        <input
          id="quick-expense-amount"
          inputMode="decimal"
          className={textInput}
          aria-invalid={Boolean(fieldErrors["quick-expense-amount"])}
          aria-describedby={
            fieldErrors["quick-expense-amount"]
              ? "quick-expense-amount-error"
              : undefined
          }
          {...form.register("amount")}
        />
        {fieldErrors["quick-expense-amount"] && (
          <p
            id="quick-expense-amount-error"
            className="mt-1 text-sm text-destructive"
          >
            {fieldErrors["quick-expense-amount"]}
          </p>
        )}
      </div>
      <div>
        <label
          htmlFor="quick-expense-title"
          className="block text-sm font-medium"
        >
          用途
        </label>
        <input
          id="quick-expense-title"
          className={textInput}
          list="quick-expense-recent-titles"
          aria-invalid={Boolean(fieldErrors["quick-expense-title"])}
          aria-describedby={
            fieldErrors["quick-expense-title"]
              ? "quick-expense-title-error"
              : undefined
          }
          {...form.register("title")}
        />
        <datalist id="quick-expense-recent-titles">
          {(preference.recentTitles ?? []).slice(0, 6).map((title) => (
            <option key={title} value={title} />
          ))}
        </datalist>
        {fieldErrors["quick-expense-title"] && (
          <p
            id="quick-expense-title-error"
            className="mt-1 text-sm text-destructive"
          >
            {fieldErrors["quick-expense-title"]}
          </p>
        )}
      </div>
      <fieldset>
        <legend className="text-sm font-medium">谁付款</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {activeMembers.map((member) => (
            <label
              key={member.id}
              className="flex min-h-11 items-center gap-2 border px-3"
            >
              <input
                type="radio"
                value={member.id}
                {...form.register("payerId")}
              />
              {member.displayName}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset id="quick-expense-participants">
        <legend className="text-sm font-medium">谁参与</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {activeMembers.map((member) => (
            <label
              key={member.id}
              className="flex min-h-11 items-center gap-2 border px-3"
            >
              <input
                type="checkbox"
                checked={values.participantIds.includes(member.id)}
                onChange={(event) =>
                  form.setValue(
                    "participantIds",
                    event.target.checked
                      ? [...values.participantIds, member.id]
                      : values.participantIds.filter((id) => id !== member.id),
                  )
                }
              />
              {member.displayName}
            </label>
          ))}
        </div>
        {fieldErrors["quick-expense-participants"] && (
          <p className="mt-1 text-sm text-destructive">
            {fieldErrors["quick-expense-participants"]}
          </p>
        )}
      </fieldset>
      <button
        type="button"
        className="min-h-11 text-primary underline"
        aria-expanded={advanced}
        onClick={() => setAdvanced((value) => !value)}
      >
        更多设置
      </button>
      {advanced && (
        <section className="space-y-4 border-t pt-4">
          <fieldset>
            <legend className="text-sm font-medium">分类</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {expenseCategories.map((category) => (
                <label
                  key={category}
                  className="flex min-h-11 items-center gap-2 border px-3"
                >
                  <input
                    type="radio"
                    value={category}
                    {...form.register("category")}
                  />
                  {expenseCategoryLabels[category]}
                </label>
              ))}
            </div>
          </fieldset>
          <button
            type="button"
            className="min-h-11 border px-3"
            aria-pressed={multiplePayers}
            onClick={() => {
              const enabling = !multiplePayers;
              setMultiplePayers(enabling);
              if (enabling && values.payerIds.length === 1) {
                form.setValue("paymentEntries", {
                  [values.payerId]: values.amount,
                });
              }
            }}
          >
            多人付款
          </button>
          {multiplePayers && (
            <PaymentEditor
              members={activeMembers}
              payerIds={values.payerIds}
              values={values.paymentEntries}
              onPayerIdsChange={(payerIds) =>
                form.setValue("payerIds", payerIds)
              }
              onValueChange={(memberId, value) =>
                form.setValue("paymentEntries", {
                  ...values.paymentEntries,
                  [memberId]: value,
                })
              }
            />
          )}
          <fieldset role="radiogroup" aria-label="分摊方式">
            <legend className="text-sm font-medium">分摊方式</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {(
                [
                  ["EQUAL", "均摊"],
                  ["EXACT", "按金额"],
                  ["PERCENTAGE", "按比例"],
                  ["WEIGHT", "按权重"],
                ] as const
              ).map(([mode, label]) => (
                <label
                  key={mode}
                  className="flex min-h-11 items-center gap-2 border px-3"
                >
                  <input
                    type="radio"
                    value={mode}
                    {...form.register("splitMode")}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <SplitEditor
            members={activeMembers}
            participantIds={values.participantIds}
            mode={values.splitMode}
            values={values.splitEntries}
            onValueChange={(memberId, value) =>
              form.setValue("splitEntries", {
                ...values.splitEntries,
                [memberId]: value,
              })
            }
          />
          <div>
            <label
              htmlFor="quick-expense-currency"
              className="block text-sm font-medium"
            >
              币种
            </label>
            <input
              id="quick-expense-currency"
              className={textInput}
              {...form.register("currency")}
            />
          </div>
          <div>
            <label
              htmlFor="quick-expense-rate"
              className="block text-sm font-medium"
            >
              汇率
            </label>
            <input
              id="quick-expense-rate"
              inputMode="decimal"
              className={textInput}
              {...form.register("exchangeRate")}
            />
          </div>
          <div>
            <label
              htmlFor="quick-expense-rate-at"
              className="block text-sm font-medium"
            >
              汇率时间
            </label>
            <input
              id="quick-expense-rate-at"
              type="datetime-local"
              className={textInput}
              {...form.register("exchangeRateAt")}
            />
          </div>
          <fieldset>
            <legend className="text-sm font-medium">汇率来源</legend>
            <label className="mt-2 flex min-h-11 items-center gap-2">
              <input
                type="radio"
                value="IDENTITY"
                {...form.register("exchangeRateSource")}
              />
              主币种
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="radio"
                value="MANUAL"
                {...form.register("exchangeRateSource")}
              />
              手动输入
            </label>
          </fieldset>
          <div>
            <label
              htmlFor="quick-expense-occurred-at"
              className="block text-sm font-medium"
            >
              消费时间
            </label>
            <input
              id="quick-expense-occurred-at"
              type="datetime-local"
              className={textInput}
              {...form.register("occurredAt")}
            />
          </div>
          <div>
            <label
              htmlFor="quick-expense-attachments"
              className="block text-sm font-medium"
            >
              附件（最多三张）
            </label>
            <input
              id="quick-expense-attachments"
              type="file"
              accept="image/*"
              multiple
              className="mt-1 block min-h-11 w-full"
              onChange={(event) => {
                const selected = Array.from(event.target.files ?? []);
                setAttachmentError(
                  selected.length > 3 ? "每笔消费最多选择三张附件。" : null,
                );
                setFiles(selected.length > 3 ? [] : selected);
              }}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              账单保存后可上传附件。
            </p>
            {attachmentError && (
              <p role="alert" className="mt-1 text-sm text-destructive">
                {attachmentError}
              </p>
            )}
          </div>
          <div>
            <label
              htmlFor="quick-expense-note"
              className="block text-sm font-medium"
            >
              备注
            </label>
            <textarea
              id="quick-expense-note"
              className={textInput}
              rows={3}
              {...form.register("note")}
            />
          </div>
        </section>
      )}
      <button
        type="submit"
        className="min-h-12 w-full bg-primary px-4 font-medium text-primary-foreground"
      >
        保存
      </button>
      {queuedMessage && (
        <p role="status" className="text-sm text-muted-foreground">
          {queuedMessage}
        </p>
      )}
    </form>
  );
}
