"use client";

import { useRef, useState } from "react";

import { useFormMotion } from "@/components/design-system/form-motion";
import { getCurrencyMinorUnits } from "@/domain/currency/currency";
import {
  minorToInput,
  type SettlementPageContextDto,
} from "@/features/settlements/api";
import type { CreateSettlementRequest } from "@/features/settlements/contracts";
import { OfflineStatus } from "@/features/expenses/components/offline-status";

export interface SettlementFormInitial {
  readonly payerMemberId: string;
  readonly receiverMemberId: string;
  readonly amountMinor: string;
}

function amountToMinor(value: string, currency: string): string {
  const precision = getCurrencyMinorUnits(currency);
  const match = value.trim().match(/^(0|[1-9]\d*)(?:\.(\d+))?$/);
  if (!match) throw new Error("金额格式不正确。");
  const fraction = match[2] ?? "";
  if (fraction.length > precision) throw new Error("金额小数位超过币种精度。");
  const amount =
    BigInt(match[1]) * 10n ** BigInt(precision) +
    BigInt((fraction + "0".repeat(precision)).slice(0, precision) || "0");
  if (amount <= 0n) throw new Error("金额必须大于 0。");
  return amount.toString();
}

function currentLocalDateTime(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

/**
 * Settlement 表单收集现实中发生的转账事实。Member 与 LEFT 的付款人固定为本人；
 * 后端仍以相同身份和活动生命周期重新授权，UI 锁定只是减少无效输入。
 */
export function SettlementForm({
  context,
  initial,
  online = true,
  onSubmit,
}: {
  readonly context: SettlementPageContextDto;
  readonly initial?: SettlementFormInitial;
  readonly online?: boolean;
  readonly onSubmit: (
    request: CreateSettlementRequest,
    amountText: string,
  ) => Promise<void>;
}) {
  const lockedPayer =
    context.activity.currentMemberStatus === "LEFT" ||
    context.activity.currentMemberRole === "MEMBER";
  const [payerMemberId, setPayerMemberId] = useState(
    lockedPayer
      ? context.activity.currentMemberId
      : (initial?.payerMemberId ?? context.activity.currentMemberId),
  );
  const [receiverMemberId, setReceiverMemberId] = useState(
    initial?.receiverMemberId ?? "",
  );
  const [amount, setAmount] = useState(
    initial ? minorToInput(initial.amountMinor, context.activity.currency) : "",
  );
  const [occurredAt, setOccurredAt] = useState(currentLocalDateTime());
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scope = useRef<HTMLFormElement>(null);
  useFormMotion(scope, error ?? "");
  const inputClass = "mt-1 min-h-11 w-full border bg-background px-3";
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      if (!online) return;
      if (!receiverMemberId) throw new Error("请选择收款人。");
      if (payerMemberId === receiverMemberId)
        throw new Error("付款人和收款人不能相同。");
      const occurred = new Date(occurredAt);
      if (Number.isNaN(occurred.valueOf()))
        throw new Error("结算时间格式不正确。");
      await onSubmit(
        {
          payerMemberId,
          receiverMemberId,
          amountMinor: amountToMinor(amount, context.activity.currency),
          occurredAt: occurred.toISOString(),
          note: note.trim() || undefined,
          confirmOverSettlement: false,
        },
        amount,
      );
    } catch (reason) {
      const message =
        reason && typeof reason === "object" && "message" in reason
          ? String(reason.message)
          : "结算保存失败，请稍后重试。";
      setError(message);
    }
  }
  return (
    <form ref={scope} onSubmit={submit} className="space-y-4" noValidate>
      <div data-motion-field>
        <label htmlFor="settlement-payer" className="block text-sm font-medium">
          付款人
        </label>
        <select
          id="settlement-payer"
          value={payerMemberId}
          disabled={lockedPayer}
          onChange={(event) => setPayerMemberId(event.target.value)}
          className={inputClass}
        >
          {context.members
            .filter((member) =>
              lockedPayer
                ? member.id === context.activity.currentMemberId
                : true,
            )
            .map((member) => (
              <option key={member.id} value={member.id}>
                {member.displayName}
              </option>
            ))}
        </select>
      </div>
      <div data-motion-field>
        <label
          htmlFor="settlement-receiver"
          className="block text-sm font-medium"
        >
          收款人
        </label>
        <select
          id="settlement-receiver"
          value={receiverMemberId}
          onChange={(event) => setReceiverMemberId(event.target.value)}
          className={inputClass}
        >
          <option value="">请选择收款人</option>
          {context.members
            .filter((member) => member.id !== payerMemberId)
            .map((member) => (
              <option key={member.id} value={member.id}>
                {member.displayName}
                {member.status === "LEFT" ? "（已退出）" : ""}
              </option>
            ))}
        </select>
      </div>
      <div data-motion-field>
        <label
          htmlFor="settlement-amount"
          className="block text-sm font-medium"
        >
          金额
        </label>
        <input
          id="settlement-amount"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          inputMode="decimal"
          className={inputClass}
        />
      </div>
      <div data-motion-field>
        <label
          htmlFor="settlement-occurred-at"
          className="block text-sm font-medium"
        >
          结算时间
        </label>
        <input
          id="settlement-occurred-at"
          type="datetime-local"
          value={occurredAt}
          onChange={(event) => setOccurredAt(event.target.value)}
          className={inputClass}
        />
      </div>
      <div data-motion-field>
        <label htmlFor="settlement-note" className="block text-sm font-medium">
          备注
        </label>
        <textarea
          id="settlement-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className={inputClass}
          rows={3}
        />
      </div>
      {error && (
        <p data-motion-error role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div data-motion-field>
        <button
          type="submit"
          disabled={!online}
          aria-describedby={online ? undefined : "settlement-offline-help"}
          className="min-h-12 w-full bg-primary px-4 font-medium text-primary-foreground"
        >
          确认已支付
        </button>
      </div>
      {!online && (
        <div data-motion-field id="settlement-offline-help">
          <OfflineStatus>结算必须联网后记录。</OfflineStatus>
        </div>
      )}
    </form>
  );
}
