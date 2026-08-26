"use client";

import { useState } from "react";

import { asCurrencyCode } from "@/domain/currency/currency";
import { formatMoney } from "@/domain/money/money";
import { ResponsiveFormOverlay } from "@/features/expenses/components/responsive-form-overlay";
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
  const currency = asCurrencyCode(data.activity.currency);
  const writable =
    data.activity.status === "ACTIVE" || data.activity.status === "ENDED";
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
      <header className="flex items-start justify-between gap-4 py-5">
        <div>
          <p className="text-sm text-muted-foreground">{data.activity.name}</p>
          <h1 className="mt-1 text-2xl font-bold">结算</h1>
        </div>
        {writable && (
          <button
            type="button"
            onClick={() => openForm()}
            className="min-h-11 bg-primary px-3 font-medium text-primary-foreground"
          >
            记录结算
          </button>
        )}
      </header>
      <section aria-labelledby="balance-heading" className="border-y py-4">
        <h2 id="balance-heading" className="text-base font-semibold">
          当前余额
        </h2>
        <div className="mt-2 space-y-2">
          {data.balances.map((balance) => (
            <div
              key={balance.memberId}
              className="flex justify-between gap-4 text-sm"
            >
              <span>{memberName(data, balance.memberId)}</span>
              <strong className="money">
                {formatMoney(
                  { currency, amountMinor: BigInt(balance.netMinor) },
                  "zh-CN",
                )}
              </strong>
            </div>
          ))}
        </div>
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
                  <strong className="money">
                    {formatMoney(
                      {
                        currency,
                        amountMinor: BigInt(recommendation.amountMinor),
                      },
                      "zh-CN",
                    )}
                  </strong>
                </p>
                {writable && (
                  <button
                    type="button"
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
          <p className="mt-2 text-sm text-muted-foreground">
            当前无需推荐转账。
          </p>
        )}
      </section>
      <section aria-labelledby="history-heading" className="mt-6">
        <h2 id="history-heading" className="text-base font-semibold">
          实际结算记录
        </h2>
        {data.settlements.length ? (
          <div className="mt-2">
            {data.settlements.map((settlement) => (
              <div key={settlement.id} className="border-b py-3">
                <div className="flex justify-between gap-4">
                  <span>
                    {memberName(data, settlement.payerMemberId)} 向{" "}
                    {memberName(data, settlement.receiverMemberId)} 支付
                  </span>
                  <strong className="money">
                    {formatMoney(
                      { currency, amountMinor: BigInt(settlement.amountMinor) },
                      "zh-CN",
                    )}
                  </strong>
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
          <p className="mt-2 text-sm text-muted-foreground">
            还没有实际结算记录。
          </p>
        )}
      </section>
      <ResponsiveFormOverlay
        open={formOpen}
        onOpenChange={setFormOpen}
        title="记录结算"
      >
        <SettlementForm context={data} initial={initial} onSubmit={execute} />
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
