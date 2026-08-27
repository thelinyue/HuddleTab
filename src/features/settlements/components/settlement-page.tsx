"use client";

import { useGSAP } from "@gsap/react";
import { ReceiptTextIcon, ScaleIcon, WalletCardsIcon } from "lucide-react";
import { useRef, useState } from "react";
import { gsap } from "gsap";

import { AppHeader } from "@/components/design-system/app-header";
import { EmptyState } from "@/components/design-system/empty-state";
import { MoneyAmount } from "@/components/design-system/money-amount";
import { asCurrencyCode } from "@/domain/currency/currency";
import { formatMoney } from "@/domain/money/money";
import { ResponsiveFormOverlay } from "@/features/expenses/components/responsive-form-overlay";
import {
  OfflineStatus,
  useOnlineStatus,
} from "@/features/expenses/components/offline-status";
import {
  minorToInput,
  type SettlementDto,
  type SettlementPageContextDto,
} from "@/features/settlements/api";
import { OverSettlementDialog } from "@/features/settlements/components/over-settlement-dialog";
import {
  SettlementForm,
  type SettlementFormInitial,
} from "@/features/settlements/components/settlement-form";
import type { CreateSettlementRequest } from "@/features/settlements/contracts";

type PageData = SettlementPageContextDto & {
  readonly settlements: readonly SettlementDto[];
};
type OverSettlement = {
  readonly request: CreateSettlementRequest;
  readonly amountText: string;
  readonly message: string;
};
type SettlementTab = "OVERVIEW" | "HISTORY";

gsap.registerPlugin(useGSAP);

function memberName(data: PageData, memberId: string): string {
  return (
    data.members.find((member) => member.id === memberId)?.displayName ??
    "未知成员"
  );
}

/**
 * 推荐与实际结算在 UI 上刻意分离：推荐只是预填表单的临时建议，历史区域只显示
 * 已确认写入的 Settlement 事实。余额、推荐和超额判断均来自服务端快照。
 */
export function SettlementPage({
  data,
  createSettlement,
  onSaved,
}: {
  readonly data: PageData;
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
  const [tab, setTab] = useState<SettlementTab>("OVERVIEW");
  const tabScope = useRef<HTMLDivElement>(null);
  const currency = asCurrencyCode(data.activity.currency);
  const online = useOnlineStatus();
  const writable =
    data.activity.status === "ACTIVE" || data.activity.status === "ENDED";
  const currentBalance = data.balances.find(
    (balance) => balance.memberId === data.activity.currentMemberId,
  );
  const currentNetMinor = BigInt(currentBalance?.netMinor ?? "0");
  const currentTone =
    currentNetMinor < 0n
      ? "payable"
      : currentNetMinor > 0n
        ? "receivable"
        : "settled";
  useGSAP(
    () => {
      const target = tabScope.current;
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
    { dependencies: [tab], revertOnUpdate: true, scope: tabScope },
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
      <AppHeader
        eyebrow={data.activity.name}
        title="结算"
        actions={
          writable ? (
            <button
              type="button"
              disabled={!online}
              onClick={() => openForm()}
              className="min-h-11 bg-primary px-3 font-medium text-primary-foreground"
            >
              记录结算
            </button>
          ) : undefined
        }
      />
      {writable && !online && (
        <OfflineStatus>结算必须联网后记录。</OfflineStatus>
      )}
      <div
        role="tablist"
        aria-label="结算内容"
        className="mt-5 grid grid-cols-2 overflow-hidden border"
      >
        {(
          [
            ["OVERVIEW", "总览"],
            ["HISTORY", "记录"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            id={`settlement-tab-${value}`}
            type="button"
            role="tab"
            aria-selected={tab === value}
            aria-controls={`settlement-panel-${value}`}
            className="min-h-11 border-r text-sm font-medium last:border-r-0 aria-selected:bg-primary aria-selected:text-primary-foreground"
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div ref={tabScope} className="will-change-transform">
        <div
          id="settlement-panel-OVERVIEW"
          role="tabpanel"
          aria-labelledby="settlement-tab-OVERVIEW"
          hidden={tab !== "OVERVIEW"}
        >
          <section className="mt-6" aria-labelledby="current-result-heading">
            <h2 id="current-result-heading" className="text-base font-semibold">
              我的结算结果
            </h2>
            <p className="mt-2 border p-3">
              <MoneyAmount
                currency={currency}
                amountMinor={currentNetMinor}
                tone={currentTone}
                size="lg"
              />
            </p>
          </section>
          <section
            aria-labelledby="balance-heading"
            className="mt-6 border-y py-4"
          >
            <h2 id="balance-heading" className="text-base font-semibold">
              全部余额
            </h2>
            {data.balances.length ? (
              <div className="mt-2 space-y-2">
                {data.balances.map((balance) => (
                  <div
                    key={balance.memberId}
                    className="flex justify-between gap-4 text-sm"
                  >
                    <span>{memberName(data, balance.memberId)}</span>
                    <MoneyAmount
                      currency={currency}
                      amountMinor={BigInt(balance.netMinor)}
                      tone={
                        BigInt(balance.netMinor) < 0n
                          ? "payable"
                          : BigInt(balance.netMinor) > 0n
                            ? "receivable"
                            : "settled"
                      }
                      size="sm"
                    />
                  </div>
                ))}
              </div>
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
              推荐结算
            </h2>
            {data.recommendations.length ? (
              <div className="mt-2 space-y-3">
                {data.recommendations.map((recommendation) => (
                  <div
                    key={`${recommendation.payerMemberId}-${recommendation.receiverMemberId}`}
                    className="flex items-center justify-between gap-4 border-b py-3"
                  >
                    <p className="text-sm">
                      {memberName(data, recommendation.payerMemberId)} 向{" "}
                      {memberName(data, recommendation.receiverMemberId)} 支付{" "}
                      <MoneyAmount
                        currency={currency}
                        amountMinor={BigInt(recommendation.amountMinor)}
                        size="sm"
                      />
                    </p>
                    {writable && (
                      <button
                        type="button"
                        disabled={!online}
                        className="min-h-11 border px-3 text-sm"
                        onClick={() => openForm(recommendation)}
                      >
                        按建议记录
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={WalletCardsIcon}
                title="没有推荐结算"
                description="当前成员余额已经平衡。"
              />
            )}
          </section>
        </div>
        <section
          id="settlement-panel-HISTORY"
          role="tabpanel"
          aria-labelledby="settlement-tab-HISTORY"
          hidden={tab !== "HISTORY"}
          className="mt-6"
        >
          <h2 className="text-base font-semibold">实际结算记录</h2>
          {data.settlements.length ? (
            <div className="mt-2">
              {data.settlements.map((settlement) => (
                <div key={settlement.id} className="border-b py-3">
                  <div className="flex justify-between gap-4">
                    <span>
                      {memberName(data, settlement.payerMemberId)} 向{" "}
                      {memberName(data, settlement.receiverMemberId)} 支付
                    </span>
                    <MoneyAmount
                      currency={currency}
                      amountMinor={BigInt(settlement.amountMinor)}
                      size="sm"
                    />
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {new Intl.DateTimeFormat("zh-CN", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(settlement.occurredAt))}
                    {settlement.note ? ` · ${settlement.note}` : ""}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={ReceiptTextIcon}
              title="没有结算记录"
              description="已确认的转账会显示在这里。"
            />
          )}
        </section>
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
      {overSettlement && (
        <OverSettlementDialog
          open
          message={overSettlement.message}
          confirmLabel={`仍然记录 ${formatMoney({ currency, amountMinor: BigInt(overSettlement.request.amountMinor) }, "zh-CN")}`}
          onOpenChange={(open) => {
            if (!open) setOverSettlement(null);
          }}
          onConfirm={() => {
            void execute(
              { ...overSettlement.request, confirmOverSettlement: true },
              overSettlement.amountText,
            );
          }}
        />
      )}
    </>
  );
}

export { minorToInput };
