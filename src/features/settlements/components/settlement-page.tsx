"use client";

import {
  ArrowRightIcon,
  ChevronRightIcon,
  CheckIcon,
  ScaleIcon,
} from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/design-system/empty-state";
import { MemberAvatar } from "@/components/design-system/member-avatar";
import { MoneyAmount } from "@/components/design-system/money-amount";
import { asCurrencyCode } from "@/domain/currency/currency";
import { formatMoney } from "@/domain/money/money";
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

function BalanceList({
  data,
  currency,
}: {
  readonly data: PageData;
  readonly currency: string;
}) {
  if (!data.balances.length)
    return (
      <EmptyState
        icon={ScaleIcon}
        title="没有余额"
        description="记录消费后会在这里显示成员余额。"
      />
    );
  return (
    <ul aria-label="成员余额" className="divide-y border-y">
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
              avatarPreset={balanceMember?.avatarPreset}
            />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {displayName}
            </span>
            <span className="flex shrink-0 items-baseline gap-1 text-sm">
              <span className="text-muted-foreground">{direction.label}</span>
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
  );
}

/**
 * 页面把服务端计算出的余额、推荐与实际记录按事实层级展开。推荐只负责预填表单，
 * 成员余额作为二级入口，不会直接写入结算；金额始终使用 bigint 的绝对值展示，方向由独立中文文本表达。
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
  const [balanceOpen, setBalanceOpen] = useState(false);
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
  // 摘要和成员入口描述的是“我之外”的协作对象；余额 Sheet 则保留全员，方便解释总账来源。
  const otherBalances = data.balances.filter(
    (balance) => balance.memberId !== data.activity.currentMemberId,
  );
  const settledCount = otherBalances.filter(
    (balance) => BigInt(balance.netMinor) === 0n,
  ).length;
  const unsettledCount = otherBalances.length - settledCount;
  const payableCount = otherBalances.filter(
    (balance) => BigInt(balance.netMinor) < 0n,
  ).length;
  const receivableCount = otherBalances.filter(
    (balance) => BigInt(balance.netMinor) > 0n,
  ).length;
  const fullySettled = data.balances.every(
    (balance) => BigInt(balance.netMinor) === 0n,
  );

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
        data-testid="settlement-page-content"
        className="flex min-w-0 flex-1 flex-col"
      >
        <main
          className={`flex flex-1 flex-col${writable ? "" : " pb-8"}`}
        >
          {writable && !online ? (
            <OfflineStatus>当前离线，联网后可记录结算。</OfflineStatus>
          ) : null}

          <section
            aria-label="结算摘要"
            className="mt-4 rounded-sm bg-summary px-4 py-4"
          >
            <div aria-label="我的结算">
              <p className="text-xs font-medium text-muted-foreground">
                我的结算
              </p>
              <p className="mt-0.5 flex flex-wrap items-baseline gap-1">
                <span className="text-xl font-semibold">
                  {currentDirection.label}
                </span>
                <MoneyAmount
                  currency={currency}
                  amountMinor={absoluteMinor(currentNetMinor)}
                  tone={currentDirection.tone}
                  size="lg"
                  className="type-display-amount"
                />
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {unsettledCount} 人未结清 · {settledCount} 人已结清
              </p>
            </div>
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
                          avatarPreset={payer?.avatarPreset}
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
                          avatarPreset={receiver?.avatarPreset}
                          className="size-8"
                        />
                        <span className="min-w-0 truncate text-sm">
                          {receiverName}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <MoneyAmount
                          currency={currency}
                          amountMinor={amountMinor}
                          size="sm"
                          className="block font-semibold"
                        />
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          待结清
                        </span>
                      </span>
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
                          className="grid min-h-16 w-full grid-cols-[minmax(0,1fr)_auto_16px] items-center gap-2 px-3 py-2 text-left outline-none transition-colors hover:bg-muted/45 focus-visible:bg-muted/45 disabled:cursor-not-allowed disabled:opacity-60"
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
              <div className="mt-2 py-3">
                <p className="text-sm font-medium text-foreground">
                  {fullySettled ? "当前无需转账" : "当前暂无推荐转账"}
                </p>
                {fullySettled ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    所有成员余额均已结清
                  </p>
                ) : null}
              </div>
            )}
          </section>

          <button
            type="button"
            aria-label="成员余额"
            aria-expanded={balanceOpen}
            onClick={() => setBalanceOpen(true)}
            className="mt-6 flex min-h-14 w-full items-center gap-3 border-y text-left"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">成员余额</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {receivableCount} 人应收 · {payableCount} 人应付
              </span>
            </span>
            <ChevronRightIcon
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
          </button>

          <section aria-labelledby="history-heading" className="mt-6">
            <div className="flex items-center justify-between gap-3">
              <h2 id="history-heading" className="text-base font-semibold">
                实际结算记录
              </h2>
              {writable ? (
                <button
                  type="button"
                  onClick={() => openForm()}
                  disabled={!online}
                  className="shrink-0 text-sm font-medium text-primary underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground"
                >
                  补记结算
                </button>
              ) : null}
            </div>
            {data.settlements.length ? (
              <ul
                aria-labelledby="history-heading"
                className="mt-2 divide-y overflow-hidden rounded-sm border"
              >
                {data.settlements.map((settlement) => {
                  const payer = member(data, settlement.payerMemberId);
                  const receiver = member(data, settlement.receiverMemberId);
                  const payerName = payer?.displayName ?? "未知成员";
                  const receiverName = receiver?.displayName ?? "未知成员";
                  return (
                    <li key={settlement.id} className="min-w-0 px-3 py-3">
                      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                        <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                          <span className="min-w-0 truncate">{payerName}</span>
                          <ArrowRightIcon
                            data-testid="history-direction"
                            aria-hidden="true"
                            className="size-4 shrink-0 text-muted-foreground"
                          />
                          <span className="min-w-0 truncate">{receiverName}</span>
                        </p>
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
              <p className="mt-2 py-3 text-sm text-muted-foreground">
                暂无结算记录
              </p>
            )}
          </section>

          {writable ? (
            <div className="sticky bottom-0 z-10 -mx-4 mt-auto bg-surface/95 px-4 pt-6 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur min-[481px]:-mx-6 min-[481px]:px-6">
              {fullySettled ? (
                <button
                  type="button"
                  disabled
                  className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border border-success/35 bg-success/10 px-4 font-medium text-success"
                >
                  <CheckIcon aria-hidden="true" className="size-5" />
                  全部已结清
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!online}
                  onClick={() => openForm()}
                  className="min-h-12 w-full rounded-lg bg-primary px-4 font-medium text-primary-foreground disabled:opacity-50"
                >
                  记录结算
                </button>
              )}
            </div>
          ) : null}
        </main>
      </div>

      <ResponsiveFormOverlay
        open={balanceOpen}
        onOpenChange={setBalanceOpen}
        title="成员余额"
      >
        <BalanceList data={data} currency={currency} />
      </ResponsiveFormOverlay>

      <ResponsiveFormOverlay
        open={formOpen}
        onOpenChange={setFormOpen}
        title="记录结算"
      >
        <SettlementForm
          context={data}
          initial={initial}
          online={online}
          timeZone={timeZone}
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
