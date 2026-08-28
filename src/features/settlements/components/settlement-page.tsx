"use client";

import {
  ArrowRightIcon,
  ChevronRightIcon,
  ReceiptTextIcon,
  ScaleIcon,
  WalletCardsIcon,
} from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/design-system/empty-state";
import { MemberAvatar } from "@/components/design-system/member-avatar";
import { MoneyAmount } from "@/components/design-system/money-amount";
import { asCurrencyCode } from "@/domain/currency/currency";
import { formatMoney } from "@/domain/money/money";
import { ActivityPageHeader } from "@/features/activities/components/activity-page-header";
import type { ExpenseFeedSummaryDto } from "@/features/expenses/api";
import {
  OfflineStatus,
  useOnlineStatus,
} from "@/features/expenses/components/offline-status";
import { ResponsiveFormOverlay } from "@/features/expenses/components/responsive-form-overlay";
import {
  minorToInput,
  type SettlementDto,
  type SettlementPageContextDto,
} from "@/features/settlements/api";
import type { CreateSettlementRequest } from "@/features/settlements/contracts";
import { OverSettlementDialog } from "@/features/settlements/components/over-settlement-dialog";
import {
  SettlementForm,
  type SettlementFormInitial,
} from "@/features/settlements/components/settlement-form";

type PageData = SettlementPageContextDto & {
  readonly summary: Pick<
    ExpenseFeedSummaryDto,
    "activityName" | "startDate" | "endDate" | "memberCount"
  >;
  readonly settlements: readonly SettlementDto[];
};

type OverSettlement = {
  readonly request: CreateSettlementRequest;
  readonly amountText: string;
  readonly message: string;
};

function member(data: PageData, memberId: string) {
  return data.members.find((item) => item.id === memberId);
}

function absoluteMinor(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function balanceDirection(value: bigint) {
  return value < 0n
    ? { label: "应付", tone: "payable" as const }
    : value > 0n
      ? { label: "应收", tone: "receivable" as const }
      : { label: "已结清", tone: "settled" as const };
}

/**
 * 页面把服务端计算出的余额、推荐与实际记录按事实层级一次展开。推荐只负责预填表单，
 * 不会直接写入结算；金额始终使用 bigint 的绝对值展示，方向由独立中文文本表达。
 */
export function SettlementPage({
  data,
  timeZone,
  createSettlement,
  onSaved,
}: {
  readonly data: PageData;
  readonly timeZone: string;
  readonly createSettlement: (
    request: CreateSettlementRequest,
  ) => Promise<{ readonly settlement: { readonly id: string } }>;
  readonly onSaved?: () => void;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [initial, setInitial] = useState<SettlementFormInitial | undefined>();
  const [overSettlement, setOverSettlement] = useState<OverSettlement | null>(
    null,
  );
  const currency = asCurrencyCode(data.activity.currency);
  const online = useOnlineStatus();
  const writable =
    data.activity.status === "ACTIVE" || data.activity.status === "ENDED";
  const currentBalance = data.balances.find(
    (balance) => balance.memberId === data.activity.currentMemberId,
  );
  const currentNetMinor = BigInt(currentBalance?.netMinor ?? "0");
  const currentDirection = balanceDirection(currentNetMinor);

  const execute = async (
    request: CreateSettlementRequest,
    amountText: string,
  ) => {
    try {
      await createSettlement(request);
      setFormOpen(false);
      setOverSettlement(null);
      onSaved?.();
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "OVER_SETTLEMENT_CONFIRMATION_REQUIRED"
      ) {
        setOverSettlement({
          request,
          amountText,
          message:
            "message" in error
              ? String(error.message)
              : "本次结算超过当前应付金额。",
        });
        return;
      }
      throw error;
    }
  };

  const openForm = (next?: SettlementFormInitial) => {
    setInitial(next);
    setFormOpen(true);
  };

  return (
    <>
      <div
        data-testid="settlement-page-surface"
        className="-mx-4 -mt-[calc(1rem+env(safe-area-inset-top))] min-h-dvh bg-surface px-4 pt-[calc(1rem+env(safe-area-inset-top))] min-[481px]:-mx-6 min-[481px]:px-6"
      >
        <ActivityPageHeader
          activityId={data.activity.id}
          name={data.summary.activityName}
          startDate={data.summary.startDate}
          endDate={data.summary.endDate}
          memberCount={data.summary.memberCount}
          status={data.activity.status}
        />

        <main className="pb-8">
          {writable && !online ? (
            <OfflineStatus>结算必须联网后记录。</OfflineStatus>
          ) : null}

          <section
            aria-label="结算摘要"
            className="mt-4 grid grid-cols-3 divide-x rounded-sm border bg-surface"
          >
            <div
              aria-label="我的结算"
              className="min-w-0 px-2 py-3 text-center"
            >
              <p className="text-xs text-muted-foreground">我的结算</p>
              <p className="mt-1 flex flex-wrap items-baseline justify-center gap-1 text-sm font-medium">
                <span>{currentDirection.label}</span>
                <MoneyAmount
                  currency={currency}
                  amountMinor={absoluteMinor(currentNetMinor)}
                  tone={currentDirection.tone}
                  size="sm"
                />
              </p>
            </div>
            <div aria-label="待结清" className="min-w-0 px-2 py-3 text-center">
              <p className="text-xs text-muted-foreground">待结清</p>
              <p className="mt-1 text-base font-semibold tabular-nums">
                {data.recommendations.length}
              </p>
            </div>
            <div aria-label="已结算" className="min-w-0 px-2 py-3 text-center">
              <p className="text-xs text-muted-foreground">已结算</p>
              <p className="mt-1 text-base font-semibold tabular-nums">
                {data.settlements.length}
              </p>
            </div>
          </section>

          <section aria-labelledby="balance-heading" className="mt-6">
            <h2 id="balance-heading" className="text-base font-semibold">
              成员余额
            </h2>
            {data.balances.length ? (
              <ul aria-label="成员余额" className="mt-2 divide-y border-y">
                {data.balances.map((balance) => {
                  const balanceMember = member(data, balance.memberId);
                  const amountMinor = BigInt(balance.netMinor);
                  const direction = balanceDirection(amountMinor);
                  const displayName = balanceMember?.displayName ?? "未知成员";
                  return (
                    <li
                      key={balance.memberId}
                      className="flex min-h-14 items-center gap-3 py-2"
                    >
                      <MemberAvatar
                        memberId={balance.memberId}
                        displayName={displayName}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {displayName}
                      </span>
                      <span className="flex shrink-0 items-baseline gap-1 text-sm">
                        <span className="text-muted-foreground">
                          {direction.label}
                        </span>
                        {amountMinor !== 0n ? (
                          <MoneyAmount
                            currency={currency}
                            amountMinor={absoluteMinor(amountMinor)}
                            tone={direction.tone}
                            size="sm"
                          />
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState
                icon={ScaleIcon}
                title="没有余额"
                description="记录消费后会在这里显示成员余额。"
              />
            )}
          </section>

          <section aria-labelledby="recommendation-heading" className="mt-6">
            <h2 id="recommendation-heading" className="text-base font-semibold">
              推荐转账
            </h2>
            {data.recommendations.length ? (
              <ul
                aria-labelledby="recommendation-heading"
                className="mt-2 divide-y overflow-hidden rounded-sm border"
              >
                {data.recommendations.map((recommendation) => {
                  const payer = member(data, recommendation.payerMemberId);
                  const receiver = member(
                    data,
                    recommendation.receiverMemberId,
                  );
                  const payerName = payer?.displayName ?? "未知成员";
                  const receiverName = receiver?.displayName ?? "未知成员";
                  const amountMinor = BigInt(recommendation.amountMinor);
                  const transfer = (
                    <>
                      <span className="grid min-w-0 grid-cols-[32px_minmax(0,1fr)_16px_32px_minmax(0,1fr)] items-center gap-2">
                        <MemberAvatar
                          memberId={recommendation.payerMemberId}
                          displayName={payerName}
                          className="size-8"
                        />
                        <span className="min-w-0 truncate text-sm">
                          {payerName}
                        </span>
                        <ArrowRightIcon
                          aria-hidden="true"
                          className="size-4 shrink-0 text-muted-foreground"
                        />
                        <MemberAvatar
                          memberId={recommendation.receiverMemberId}
                          displayName={receiverName}
                          className="size-8"
                        />
                        <span className="min-w-0 truncate text-sm">
                          {receiverName}
                        </span>
                      </span>
                      <MoneyAmount
                        currency={currency}
                        amountMinor={amountMinor}
                        size="sm"
                        className="shrink-0 font-semibold"
                      />
                    </>
                  );
                  return (
                    <li
                      key={`${recommendation.payerMemberId}-${recommendation.receiverMemberId}`}
                    >
                      {writable ? (
                        <button
                          type="button"
                          aria-label={`按建议记录：${payerName}向${receiverName}支付 ${formatMoney(
                            { currency, amountMinor },
                            "zh-CN",
                          )}`}
                          disabled={!online}
                          className="grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto_16px] items-center gap-2 px-3 py-2 text-left outline-none transition-colors hover:bg-muted/45 focus-visible:bg-muted/45 disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => openForm(recommendation)}
                        >
                          {transfer}
                          <ChevronRightIcon
                            data-testid="recommendation-chevron"
                            aria-hidden="true"
                            className="size-4 text-muted-foreground/70"
                          />
                        </button>
                      ) : (
                        <div className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-2">
                          {transfer}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState
                icon={WalletCardsIcon}
                title="没有推荐转账"
                description="当前成员余额已经平衡。"
              />
            )}
          </section>

          {writable ? (
            <button
              type="button"
              disabled={!online}
              onClick={() => openForm()}
              className="mt-6 min-h-12 w-full rounded-lg bg-primary px-4 font-medium text-primary-foreground disabled:opacity-50"
            >
              记录结算
            </button>
          ) : null}

          <section aria-labelledby="history-heading" className="mt-6">
            <h2 id="history-heading" className="text-base font-semibold">
              实际结算记录
            </h2>
            {data.settlements.length ? (
              <ul
                aria-labelledby="history-heading"
                className="mt-2 divide-y overflow-hidden rounded-sm border"
              >
                {data.settlements.map((settlement) => {
                  const payerName =
                    member(data, settlement.payerMemberId)?.displayName ??
                    "未知成员";
                  const receiverName =
                    member(data, settlement.receiverMemberId)?.displayName ??
                    "未知成员";
                  return (
                    <li key={settlement.id} className="min-w-0 px-3 py-3">
                      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                        <div className="grid min-w-0 grid-cols-[32px_minmax(0,1fr)_16px_32px_minmax(0,1fr)] items-center gap-2">
                          <MemberAvatar
                            memberId={settlement.payerMemberId}
                            displayName={payerName}
                            className="size-8"
                          />
                          <span className="min-w-0 truncate text-sm font-medium">
                            {payerName}
                          </span>
                          <ArrowRightIcon
                            data-testid="history-direction"
                            aria-hidden="true"
                            className="size-4 shrink-0 text-muted-foreground"
                          />
                          <MemberAvatar
                            memberId={settlement.receiverMemberId}
                            displayName={receiverName}
                            className="size-8"
                          />
                          <span className="min-w-0 truncate text-sm font-medium">
                            {receiverName}
                          </span>
                        </div>
                        <MoneyAmount
                          currency={settlement.currency}
                          amountMinor={BigInt(settlement.amountMinor)}
                          size="sm"
                          className="shrink-0 font-semibold"
                        />
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {new Intl.DateTimeFormat("zh-CN", {
                          dateStyle: "medium",
                          timeStyle: "short",
                          timeZone,
                        }).format(new Date(settlement.occurredAt))}
                      </p>
                      {settlement.note ? (
                        <p className="mt-1 min-w-0 text-sm text-muted-foreground [overflow-wrap:anywhere]">
                          {settlement.note}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState
                icon={ReceiptTextIcon}
                title="没有结算记录"
                description="已确认的转账会显示在这里。"
              />
            )}
          </section>
        </main>
      </div>

      <ResponsiveFormOverlay
        open={formOpen}
        onOpenChange={setFormOpen}
        title="记录结算"
      >
        <SettlementForm
          context={data}
          initial={initial}
          online={online}
          onSubmit={execute}
        />
      </ResponsiveFormOverlay>

      {overSettlement ? (
        <OverSettlementDialog
          open
          message={overSettlement.message}
          confirmLabel={`仍然记录 ${formatMoney(
            {
              currency,
              amountMinor: BigInt(overSettlement.request.amountMinor),
            },
            "zh-CN",
          )}`}
          onOpenChange={(open) => {
            if (!open) setOverSettlement(null);
          }}
          onConfirm={() => {
            void execute(
              {
                ...overSettlement.request,
                confirmOverSettlement: true,
              },
              overSettlement.amountText,
            );
          }}
        />
      ) : null}
    </>
  );
}

export { minorToInput };
