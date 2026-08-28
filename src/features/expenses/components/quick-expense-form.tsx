"use client";

import { useGSAP } from "@gsap/react";
import { CheckIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { gsap } from "gsap";

import {
  asCurrencyCode,
  getCurrencyMinorUnits,
} from "@/domain/currency/currency";
import { formatMoney } from "@/domain/money/money";
import { MemberAvatar } from "@/components/design-system/member-avatar";
import { MoneyAmount } from "@/components/design-system/money-amount";
import { Button } from "@/components/ui/button";
import { createExpense } from "@/features/expenses/api";
import {
  expenseCategories,
  expenseCategoryLabels,
  type ExpenseCategory,
} from "@/features/expenses/categories";
import { PaymentEditor } from "@/features/expenses/components/payment-editor";
import { SplitEditor } from "@/features/expenses/components/split-editor";
import type { CreateExpenseRequest } from "@/features/expenses/contracts";
import { splitExpense, type SplitInput } from "@/domain/splitting/split";
import type { AvatarPreset } from "@/features/me/avatar-presets";
import { enqueueExpense } from "@/pwa/sync-queue/enqueue-expense";
import { requestForegroundSync } from "@/pwa/sync-queue/sync-events";

type SplitMode = "EQUAL" | "EXACT" | "PERCENTAGE" | "WEIGHT";
type FormValues = {
  amount: string;
  title: string;
  category: ExpenseCategory;
  currency: string;
  exchangeRate: string;
  exchangeRateSource: CreateExpenseRequest["exchangeRateSource"];
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

export type QuickExpenseInitialValues = FormValues;

export type QuickExpenseStep = "ENTRY" | "SPLIT";

gsap.registerPlugin(useGSAP);

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

function currencySymbol(currency: string): string {
  try {
    return (
      new Intl.NumberFormat("zh-CN", {
        style: "currency",
        currency: currency.trim().toUpperCase(),
      })
        .formatToParts(0)
        .find((part) => part.type === "currency")?.value ?? currency
    );
  } catch {
    return currency.trim().toUpperCase();
  }
}

/** 预览沿用提交前的最小单位转换，避免把浮点数带入分摊设置界面。 */
function previewAmountMinor(amount: string, currency: string): bigint | null {
  try {
    asCurrencyCode(currency.trim().toUpperCase());
    return BigInt(amountToMinor(amount, currency));
  } catch {
    return null;
  }
}

/** 四种预览与正式提交复用同一套精确文本转换和领域分配规则。 */
function previewSplit(
  totalMinor: bigint | null,
  currency: string,
  participantIds: readonly string[],
  mode: SplitMode,
  entries: Readonly<Record<string, string>>,
) {
  if (totalMinor === null) return null;
  try {
    const input: SplitInput =
      mode === "EQUAL"
        ? { mode, totalMinor, memberIds: participantIds }
        : mode === "EXACT"
          ? {
              mode,
              totalMinor,
              shares: participantIds.map((memberId) => ({
                memberId,
                amountMinor: BigInt(
                  amountToMinor(entries[memberId] ?? "", currency),
                ),
              })),
            }
          : mode === "PERCENTAGE"
            ? {
                mode,
                totalMinor,
                shares: participantIds.map((memberId) => ({
                  memberId,
                  basisPoints: BigInt(
                    decimalToHundredths(entries[memberId] ?? "", "比例"),
                  ),
                })),
              }
            : {
                mode,
                totalMinor,
                shares: participantIds.map((memberId) => ({
                  memberId,
                  weightHundredths: BigInt(
                    decimalToHundredths(entries[memberId] ?? "", "权重"),
                  ),
                })),
              };
    return splitExpense(input);
  } catch {
    return null;
  }
}

/** 摘要只累计用户已填的合法规则值，未填写按零处理，非法文本保持“待完成”。 */
function previewSplitProgress(
  currency: string,
  participantIds: readonly string[],
  mode: Exclude<SplitMode, "EQUAL">,
  entries: Readonly<Record<string, string>>,
): bigint | null {
  try {
    return participantIds.reduce((sum, memberId) => {
      const value = (entries[memberId] ?? "").trim();
      if (!value) return sum;
      const units =
        mode === "EXACT"
          ? amountToMinor(value, currency)
          : decimalToHundredths(value, mode === "PERCENTAGE" ? "比例" : "份数");
      return sum + BigInt(units);
    }, 0n);
  } catch {
    return null;
  }
}

function formatHundredths(value: bigint): string {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;
}

export interface QuickExpenseMember {
  readonly id: string;
  readonly displayName: string;
  readonly status: "ACTIVE" | "LEFT";
  readonly avatarPreset?: AvatarPreset | null;
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
  step = "ENTRY",
  onStepChange = () => undefined,
  onSplitValidityChange,
  onSaved,
  onQueued,
  initialValues,
  submitExpense,
  submitLabel = "保存",
  allowAttachments = true,
  onConflict,
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
  readonly step?: QuickExpenseStep;
  readonly onStepChange?: (step: QuickExpenseStep) => void;
  readonly onSplitValidityChange?: (valid: boolean) => void;
  readonly onSaved: (expense: {
    readonly id: string;
    readonly title: string;
    readonly baseAmountMinor?: string;
    readonly baseCurrency?: string;
  }) => void;
  readonly onQueued?: (mutationId: string) => void;
  readonly initialValues?: QuickExpenseInitialValues;
  readonly submitExpense?: (request: CreateExpenseRequest) => Promise<{
    readonly id: string;
    readonly title: string;
    readonly baseAmountMinor?: string;
    readonly baseCurrency?: string;
  }>;
  readonly submitLabel?: string;
  readonly allowAttachments?: boolean;
  readonly onConflict?: () => void;
}) {
  const [advanced, setAdvanced] = useState(false);
  const [multiplePayers, setMultiplePayers] = useState(
    () => (initialValues?.payerIds.length ?? 0) > 1,
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [queuedMessage, setQueuedMessage] = useState<string | null>(null);
  const [versionConflict, setVersionConflict] = useState(false);
  const [files, setFiles] = useState<readonly File[]>([]);
  const [clientMutationId] = useState(() => crypto.randomUUID());
  const stepScope = useRef<HTMLDivElement>(null);
  const activeMembers = members.filter((member) => member.status === "ACTIVE");
  const preferredParticipants = preference.recentParticipantIds.filter((id) =>
    activeMembers.some((member) => member.id === id),
  );
  const preferredPayerIds = preference.recentPayerIds.filter((id) =>
    activeMembers.some((member) => member.id === id),
  );
  const preferredPayer = preferredPayerIds[0] ?? activity.currentMemberId;
  const form = useForm<FormValues>({
    defaultValues: initialValues ?? {
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
  const payer =
    activeMembers.find((member) => member.id === values.payerId) ??
    activeMembers[0];
  const totalMinorPreview = previewAmountMinor(values.amount, values.currency);
  const splitPreview = previewSplit(
    totalMinorPreview,
    values.currency,
    values.participantIds,
    values.splitMode,
    values.splitEntries,
  );
  const splitValid = splitPreview !== null;
  const splitProgress =
    values.splitMode === "EQUAL"
      ? null
      : previewSplitProgress(
          values.currency,
          values.participantIds,
          values.splitMode,
          values.splitEntries,
        );
  useEffect(() => {
    onSplitValidityChange?.(splitValid);
  }, [onSplitValidityChange, splitValid]);
  useGSAP(
    () => {
      const target = stepScope.current;
      if (!target) return;
      if (
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      ) {
        gsap.set(target, { autoAlpha: 1, x: 0 });
        return;
      }
      gsap.fromTo(
        target,
        { autoAlpha: 0, x: 12 },
        {
          autoAlpha: 1,
          duration: 0.22,
          ease: "power1.out",
          overwrite: "auto",
          x: 0,
        },
      );
    },
    { dependencies: [step], revertOnUpdate: true, scope: stepScope },
  );
  useEffect(() => {
    if (submitError)
      document.getElementById("quick-expense-error-summary")?.focus();
  }, [submitError]);
  const showError = (message: string, fieldId?: string) => {
    setVersionConflict(false);
    setSubmitError(message);
    setFieldErrors(fieldId ? { [fieldId]: message } : {});
  };
  async function submit(next: FormValues) {
    setSubmitError(null);
    setFieldErrors({});
    setQueuedMessage(null);
    setVersionConflict(false);
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
      if (submitExpense) {
        if (!online) throw new Error("编辑账单需要联网，请恢复网络后重试。");
        onSaved(await submitExpense(request));
        return;
      }
      if (!online || files.length) {
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
      if (error instanceof Error && "status" in error && error.status === 409) {
        setVersionConflict(true);
        setSubmitError(
          "账单已被其他人更新。当前输入已保留，请查看最新内容后重新编辑。",
        );
        setFieldErrors({});
        return;
      }
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
    requestForegroundSync();
    onQueued?.(queued.mutation.id);
  }
  const textInput =
    "mt-1 min-h-11 w-full rounded-lg border bg-background px-3 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30";
  return (
    <form
      id="quick-expense-form"
      onSubmit={form.handleSubmit(submit)}
      className="flex h-full flex-col"
      noValidate
    >
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
            <>
              <p className="mt-1">{submitError}</p>
              {versionConflict && onConflict ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2 border-destructive/30 bg-surface text-foreground"
                  onClick={onConflict}
                >
                  查看最新内容
                </Button>
              ) : null}
            </>
          )}
        </div>
      )}
      <div
        ref={stepScope}
        data-quick-expense-step={step}
        className="min-h-0 flex-1"
      >
        <div
          hidden={step !== "ENTRY"}
          className="flex min-h-full flex-col gap-4 py-2"
        >
          <div className="text-center">
            <label htmlFor="quick-expense-amount" className="sr-only">
              金额
            </label>
            <div className="flex min-h-11 items-baseline justify-center gap-2">
              <span
                aria-hidden="true"
                className="font-amount type-amount font-medium text-foreground"
              >
                {currencySymbol(values.currency)}
              </span>
              <input
                id="quick-expense-amount"
                inputMode="decimal"
                autoFocus
                placeholder="0.00"
                className="font-amount type-display-amount min-h-11 w-48 max-w-3/4 bg-transparent text-center font-semibold text-primary outline-none placeholder:text-muted-foreground/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                aria-invalid={Boolean(fieldErrors["quick-expense-amount"])}
                aria-describedby={
                  fieldErrors["quick-expense-amount"]
                    ? "quick-expense-amount-error"
                    : undefined
                }
                {...form.register("amount")}
              />
            </div>
            <p
              aria-hidden="true"
              className="type-caption text-muted-foreground"
            >
              金额
            </p>
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
              className="block rounded-md border bg-surface px-3 py-2 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30"
            >
              <span className="type-caption block text-muted-foreground">
                用途
              </span>
              <input
                id="quick-expense-title"
                className="type-body min-h-6 w-full bg-transparent outline-none placeholder:text-muted-foreground/60"
                list="quick-expense-recent-titles"
                placeholder="例如：晚餐"
                aria-invalid={Boolean(fieldErrors["quick-expense-title"])}
                aria-describedby={
                  fieldErrors["quick-expense-title"]
                    ? "quick-expense-title-error"
                    : undefined
                }
                {...form.register("title")}
              />
            </label>
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
          <div className="rounded-md border bg-surface px-3 py-2 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
            <span className="type-caption block text-muted-foreground">
              谁付款
            </span>
            <div className="flex min-h-11 items-center gap-2">
              {payer ? (
                <MemberAvatar
                  memberId={payer.id}
                  displayName={payer.displayName}
                  avatarPreset={payer.avatarPreset}
                  className="size-8"
                />
              ) : null}
              <select
                aria-label="谁付款"
                className="type-body min-h-11 min-w-0 flex-1 appearance-none bg-transparent font-medium outline-none"
                {...form.register("payerId")}
              >
                {activeMembers.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.displayName}
                  </option>
                ))}
              </select>
              <ChevronRightIcon
                aria-hidden="true"
                className="size-4 text-muted-foreground"
              />
            </div>
          </div>
          <fieldset
            id="quick-expense-participants"
            aria-label="参与成员"
            className="px-0"
          >
            <legend className="sr-only">参与成员</legend>
            <div className="flex min-h-11 items-center justify-between gap-3">
              <span className="type-label font-medium">
                参与成员（{values.participantIds.length}人）
              </span>
              <button
                type="button"
                className="type-label min-h-11 font-medium text-primary"
                onClick={() => onStepChange("SPLIT")}
              >
                分摊设置
              </button>
            </div>
            <div className="mt-1 flex flex-wrap gap-3">
              {activeMembers.map((member) => (
                <label
                  key={member.id}
                  className="flex min-h-16 min-w-12 cursor-pointer flex-col items-center justify-center gap-1 rounded-sm text-center focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring"
                >
                  <input
                    type="checkbox"
                    aria-label={`${member.displayName}参与`}
                    className="sr-only"
                    checked={values.participantIds.includes(member.id)}
                    onChange={(event) =>
                      form.setValue(
                        "participantIds",
                        event.target.checked
                          ? [...values.participantIds, member.id]
                          : values.participantIds.filter(
                              (id) => id !== member.id,
                            ),
                      )
                    }
                  />
                  <span className="relative">
                    <MemberAvatar
                      memberId={member.id}
                      displayName={member.displayName}
                      avatarPreset={member.avatarPreset}
                      className={`size-9 ${values.participantIds.includes(member.id) ? "ring-2 ring-primary/35 ring-offset-1" : "opacity-45 grayscale"}`}
                    />
                    {values.participantIds.includes(member.id) ? (
                      <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <CheckIcon aria-hidden="true" className="size-2.5" />
                      </span>
                    ) : null}
                  </span>
                  <span className="type-caption max-w-16 truncate">
                    {member.displayName}
                  </span>
                </label>
              ))}
            </div>
            {fieldErrors["quick-expense-participants"] && (
              <p className="mt-1 text-sm text-destructive">
                {fieldErrors["quick-expense-participants"]}
              </p>
            )}
          </fieldset>
          <Button
            type="button"
            variant="outline"
            className="type-body w-full justify-between rounded-md px-3 font-medium"
            aria-expanded={advanced}
            onClick={() => setAdvanced((value) => !value)}
          >
            <span>更多设置</span>
            <ChevronRightIcon
              aria-hidden="true"
              className={`size-4 text-muted-foreground transition-transform ${advanced ? "rotate-90" : ""}`}
            />
          </Button>
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
              {allowAttachments ? (
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
                        selected.length > 3
                          ? "每笔消费最多选择三张附件。"
                          : null,
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
              ) : null}
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
          <Button
            type="submit"
            size="lg"
            className="type-section-title mt-auto h-12 w-full rounded-md font-semibold"
          >
            {submitLabel}
          </Button>
        </div>
        {step === "SPLIT" && (
          <section className="grid gap-4 py-2" aria-label="分摊设置内容">
            <fieldset role="radiogroup" aria-label="分摊方式">
              <legend className="type-label font-medium">分摊方式</legend>
              <div className="mt-2 grid grid-cols-4 gap-2">
                {(
                  [
                    ["EQUAL", "均摊"],
                    ["EXACT", "按金额"],
                    ["PERCENTAGE", "按比例"],
                    ["WEIGHT", "按份数"],
                  ] as const
                ).map(([mode, label]) => (
                  <label
                    key={mode}
                    className="relative min-h-11 cursor-pointer rounded-sm"
                  >
                    <input
                      type="radio"
                      value={mode}
                      className="peer sr-only"
                      {...form.register("splitMode")}
                    />
                    <span className="type-label flex min-h-11 items-center justify-center rounded-sm border bg-background px-2 text-center transition-colors peer-checked:border-primary peer-checked:bg-primary/10 peer-checked:font-semibold peer-checked:text-primary peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50 peer-focus-visible:outline-none">
                      {label}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <SplitEditor
              members={activeMembers}
              participantIds={values.participantIds}
              mode={values.splitMode}
              values={values.splitEntries}
              currency={values.currency}
              allocations={splitPreview}
              onValueChange={(memberId, value) =>
                form.setValue("splitEntries", {
                  ...values.splitEntries,
                  [memberId]: value,
                })
              }
            />
            <div aria-label="分摊摘要" className="mt-2 border-t py-2">
              {values.splitMode === "EQUAL" ? (
                <>
                  <p className="flex min-h-11 items-center justify-between">
                    <span className="type-label text-muted-foreground">
                      合计
                    </span>
                    {totalMinorPreview === null ? (
                      <strong className="type-body">待填写金额</strong>
                    ) : (
                      <MoneyAmount
                        currency={values.currency}
                        amountMinor={totalMinorPreview}
                        className="font-semibold"
                      />
                    )}
                  </p>
                  <p className="flex min-h-11 items-center justify-between">
                    <span className="type-label text-muted-foreground">
                      人均
                    </span>
                    {totalMinorPreview === null ||
                    !values.participantIds.length ? (
                      <strong className="type-body">待完成</strong>
                    ) : (
                      <MoneyAmount
                        currency={values.currency}
                        amountMinor={
                          totalMinorPreview /
                          BigInt(values.participantIds.length)
                        }
                        className="font-medium text-muted-foreground"
                      />
                    )}
                  </p>
                </>
              ) : values.splitMode === "EXACT" ? (
                <p className="flex min-h-11 items-center justify-between">
                  <span className="type-label text-muted-foreground">
                    已分配
                  </span>
                  <strong className="money type-amount font-semibold">
                    {splitProgress === null || totalMinorPreview === null
                      ? "待完成"
                      : `${formatMoney(
                          {
                            currency: asCurrencyCode(values.currency),
                            amountMinor: splitProgress,
                          },
                          "zh-CN",
                        )} / ${formatMoney(
                          {
                            currency: asCurrencyCode(values.currency),
                            amountMinor: totalMinorPreview,
                          },
                          "zh-CN",
                        )}`}
                  </strong>
                </p>
              ) : (
                <>
                  <p className="flex min-h-11 items-center justify-between">
                    <span className="type-label text-muted-foreground">
                      {values.splitMode === "PERCENTAGE" ? "已分配" : "总份数"}
                    </span>
                    <strong className="money type-amount font-semibold">
                      {splitProgress === null
                        ? "待完成"
                        : `${formatHundredths(splitProgress)}${
                            values.splitMode === "PERCENTAGE" ? "%" : ""
                          }`}
                    </strong>
                  </p>
                  <p className="flex min-h-11 items-center justify-between">
                    <span className="type-label text-muted-foreground">
                      合计
                    </span>
                    {totalMinorPreview === null ? (
                      <strong className="type-body">待填写金额</strong>
                    ) : (
                      <MoneyAmount
                        currency={values.currency}
                        amountMinor={totalMinorPreview}
                        className="font-semibold"
                      />
                    )}
                  </p>
                </>
              )}
            </div>
          </section>
        )}
      </div>
      {queuedMessage && (
        <p role="status" className="text-sm text-muted-foreground">
          {queuedMessage}
        </p>
      )}
    </form>
  );
}
