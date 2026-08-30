"use client";

import { useRef, useState } from "react";

import { MoneyAmount } from "@/components/design-system/money-amount";
import { Input } from "@/components/ui/input";
import { getCurrencyMinorUnits } from "@/domain/currency/currency";
import type { CreateExpenseRequest } from "@/features/expenses/contracts";
import {
  MemberPickerSheet,
  MemberPickerTrigger,
  type MemberPickerMember,
  type MemberPickerView,
} from "@/features/members/components/member-picker";

export type PayerSelection =
  | { readonly mode: "single"; readonly memberId: string }
  | {
      readonly mode: "multiple";
      readonly memberIds: readonly string[];
      readonly amountInputs: Readonly<Record<string, string>>;
    };

export interface ResolvedPayerPayments {
  readonly payments: CreateExpenseRequest["payments"] | null;
  readonly allocatedMinor: bigint;
  readonly error: string | null;
}

function amountInputToMinor(value: string, currency: string): bigint {
  const precision = getCurrencyMinorUnits(currency);
  const match = value.trim().match(/^(0|[1-9]\d*)(?:\.(\d+))?$/);
  if (!match || (match[2]?.length ?? 0) > precision) {
    throw new Error("付款金额格式不正确。");
  }
  const fraction = (match[2] ?? "").padEnd(precision, "0");
  const amount =
    BigInt(match[1]) * 10n ** BigInt(precision) + BigInt(fraction || "0");
  if (amount <= 0n) throw new Error("付款金额必须大于 0。");
  return amount;
}

function minorToAmountInput(amountMinor: bigint, currency: string): string {
  const precision = getCurrencyMinorUnits(currency);
  if (precision === 0) return amountMinor.toString();
  const scale = 10n ** BigInt(precision);
  return `${amountMinor / scale}.${(amountMinor % scale)
    .toString()
    .padStart(precision, "0")}`;
}

/**
 * 单付款始终从当前账单总额派生；多人付款只校验用户明确输入，绝不在总额变化后
 * 自动调整任一成员金额。返回 null payments 时，调用方必须阻止保存。
 */
export function resolvePayerPayments(
  selection: PayerSelection,
  totalMinor: bigint | null,
  currency: string,
): ResolvedPayerPayments {
  if (selection.mode === "single") {
    if (!selection.memberId) {
      return { payments: null, allocatedMinor: 0n, error: "请选择付款人。" };
    }
    if (totalMinor === null) {
      return {
        payments: null,
        allocatedMinor: 0n,
        error: "请先填写账单金额。",
      };
    }
    return {
      payments: [
        { memberId: selection.memberId, amountMinor: totalMinor.toString() },
      ],
      allocatedMinor: totalMinor,
      error: null,
    };
  }

  if (totalMinor === null) {
    return {
      payments: null,
      allocatedMinor: 0n,
      error: "先填写账单金额，再分配多人付款金额",
    };
  }
  if (!selection.memberIds.length) {
    return {
      payments: null,
      allocatedMinor: 0n,
      error: "至少选择一名付款人。",
    };
  }

  let allocatedMinor = 0n;
  const payments: { memberId: string; amountMinor: string }[] = [];
  try {
    for (const memberId of selection.memberIds) {
      const amountMinor = amountInputToMinor(
        selection.amountInputs[memberId] ?? "",
        currency,
      );
      allocatedMinor += amountMinor;
      payments.push({ memberId, amountMinor: amountMinor.toString() });
    }
  } catch (error) {
    return {
      payments: null,
      allocatedMinor,
      error: error instanceof Error ? error.message : "付款金额格式不正确。",
    };
  }

  if (allocatedMinor !== totalMinor) {
    return {
      payments: null,
      allocatedMinor,
      error: "付款合计必须等于消费金额。",
    };
  }
  return { payments, allocatedMinor, error: null };
}

function cloneSelection(selection: PayerSelection): PayerSelection {
  return selection.mode === "single"
    ? { ...selection }
    : {
        mode: "multiple",
        memberIds: [...selection.memberIds],
        amountInputs: { ...selection.amountInputs },
      };
}

/** 付款面板组合成员选择能力，并独占付款模式、金额草稿和守恒校验。 */
export function PayerPicker({
  members,
  value,
  onChange,
  totalMinor,
  currency,
  canAddGuest = false,
  online,
  onAddGuest,
  open: controlledOpen,
  view: controlledView,
  showTrigger = true,
  inline = false,
  onViewChange,
  onOpenChange,
}: {
  readonly members: readonly MemberPickerMember[];
  readonly value: PayerSelection;
  readonly onChange: (selection: PayerSelection) => void;
  readonly totalMinor: bigint | null;
  readonly currency: string;
  readonly canAddGuest?: boolean;
  readonly online: boolean;
  readonly onAddGuest?: (displayName: string) => Promise<MemberPickerMember>;
  readonly open?: boolean;
  readonly view?: MemberPickerView;
  readonly showTrigger?: boolean;
  readonly inline?: boolean;
  readonly onViewChange?: (view: MemberPickerView) => void;
  readonly onOpenChange?: (open: boolean) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [internalOpen, setInternalOpen] = useState(false);
  const [internalView, setInternalView] = useState<MemberPickerView>("members");
  const open = controlledOpen ?? internalOpen;
  const view = controlledView ?? internalView;
  const [draft, setDraft] = useState<PayerSelection>(() =>
    cloneSelection(value),
  );
  const selectedIds =
    draft.mode === "single" ? [draft.memberId] : draft.memberIds;
  const committedIds =
    value.mode === "single" ? [value.memberId] : value.memberIds;
  const resolution = resolvePayerPayments(draft, totalMinor, currency);

  const updateOpen = (nextOpen: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  const updateView = (nextView: MemberPickerView) => {
    if (controlledView === undefined) setInternalView(nextView);
    onViewChange?.(nextView);
  };

  const openPicker = () => {
    setDraft(cloneSelection(value));
    updateView("members");
    updateOpen(true);
  };

  const switchToMultiple = () => {
    if (draft.mode === "multiple") return;
    setDraft({
      mode: "multiple",
      memberIds: draft.memberId ? [draft.memberId] : [],
      amountInputs:
        draft.memberId && totalMinor !== null
          ? { [draft.memberId]: minorToAmountInput(totalMinor, currency) }
          : {},
    });
  };

  const switchToSingle = () => {
    if (draft.mode === "single") return;
    setDraft({ mode: "single", memberId: draft.memberIds[0] ?? "" });
  };

  return (
    <>
      {showTrigger ? (
        <MemberPickerTrigger
          label="谁付款"
          members={members}
          selectedIds={committedIds}
          onClick={openPicker}
          buttonRef={triggerRef}
        />
      ) : null}
      <MemberPickerSheet
        open={open}
        onOpenChange={updateOpen}
        title="谁付款"
        mode={draft.mode === "single" ? "single" : "multiple"}
        members={members}
        selectedIds={selectedIds}
        view={view}
        onSelectedIdsChange={(ids) => {
          setDraft((current) =>
            current.mode === "single"
              ? { mode: "single", memberId: ids[0] ?? "" }
              : { ...current, memberIds: ids },
          );
        }}
        onCommit={(ids) => {
          if (draft.mode === "single") {
            onChange({ mode: "single", memberId: ids[0] ?? "" });
          } else {
            onChange({ ...draft, memberIds: ids });
          }
          updateOpen(false);
        }}
        canAddGuest={canAddGuest}
        online={online}
        onAddGuest={onAddGuest}
        beforeList={
          <div
            role="group"
            aria-label="付款模式"
            className="mb-4 grid grid-cols-2 rounded-md bg-muted p-1"
          >
            <button
              type="button"
              aria-pressed={draft.mode === "single"}
              className="min-h-11 rounded-sm px-3 font-medium aria-pressed:bg-surface aria-pressed:shadow-sm"
              onClick={switchToSingle}
            >
              单人付款
            </button>
            <button
              type="button"
              aria-pressed={draft.mode === "multiple"}
              className="min-h-11 rounded-sm px-3 font-medium aria-pressed:bg-surface aria-pressed:shadow-sm"
              onClick={switchToMultiple}
            >
              多人付款
            </button>
          </div>
        }
        renderMemberDetails={(member, selected) =>
          draft.mode === "multiple" && selected ? (
            <label className="flex min-w-0 items-center justify-end">
              <span className="sr-only">{member.displayName}付款金额</span>
              <Input
                inputMode="decimal"
                aria-label={`${member.displayName}付款金额`}
                value={draft.amountInputs[member.id] ?? ""}
                disabled={totalMinor === null}
                className="money ml-auto w-32 text-right"
                onChange={(event) =>
                  setDraft((current) =>
                    current.mode === "multiple"
                      ? {
                          ...current,
                          amountInputs: {
                            ...current.amountInputs,
                            [member.id]: event.target.value,
                          },
                        }
                      : current,
                  )
                }
              />
            </label>
          ) : null
        }
        footerSummary={
          draft.mode === "multiple" ? (
            <div aria-live="polite" className="space-y-1 text-sm">
              {totalMinor === null ? (
                <p className="text-muted-foreground">
                  先填写账单金额，再分配多人付款金额
                </p>
              ) : (
                <p className="flex items-center gap-1">
                  <span>已分配</span>
                  <MoneyAmount
                    currency={currency}
                    amountMinor={resolution.allocatedMinor}
                    size="sm"
                  />
                  <span>/</span>
                  <MoneyAmount
                    currency={currency}
                    amountMinor={totalMinor}
                    size="sm"
                  />
                </p>
              )}
              {resolution.error && totalMinor !== null ? (
                <p className="text-destructive">{resolution.error}</p>
              ) : null}
            </div>
          ) : null
        }
        canComplete={draft.mode === "multiple" && resolution.payments !== null}
        returnFocusRef={triggerRef}
        inline={inline}
        onViewChange={updateView}
      />
    </>
  );
}
