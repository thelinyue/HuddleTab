import type postgres from "postgres";

import { calculateLedger, type LedgerBalance } from "@/domain/ledger/ledger";
import { formatMoney } from "@/domain/money/money";
import { asCurrencyCode } from "@/domain/currency/currency";
import type { CreateSettlementRequest } from "@/features/settlements/contracts";
import { ApplicationError } from "@/server/errors/application-error";
import { authorizeActivityOperation } from "@/server/permissions/authorize-activity-operation";
import { LedgerRepository } from "@/server/repositories/ledger-repository";
import { SettlementRepository } from "@/server/repositories/settlement-repository";

/**
 * 真实结算的唯一写入口。权限判断始终先于成员事实写入；后续超额确认和版本更新
 * 也必须复用此入口，不能让 Route Handler 直接操作 settlements 表。
 */
export class SettlementService {
  private readonly repository = new SettlementRepository();
  private readonly ledgerRepository = new LedgerRepository();

  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  async create(
    session: { readonly user: { readonly id: string } } | null,
    activityId: string,
    input: CreateSettlementRequest,
  ) {
    return this.sql.begin(async (transaction) => {
      await this.repository.lockActivity(transaction, activityId);
      const authorization = await authorizeActivityOperation(transaction, {
        session,
        activityId,
        operation: "SETTLEMENT_CREATE",
        settlementPayerMemberId: input.payerMemberId,
      });
      await this.repository.requireAccountingMember(
        transaction,
        activityId,
        input.payerMemberId,
      );
      await this.repository.requireAccountingMember(
        transaction,
        activityId,
        input.receiverMemberId,
      );
      const currentPayable = payableFromTo(
        calculateLedger(
          await this.ledgerRepository.loadFacts(transaction, activityId),
        ),
        input.payerMemberId,
        input.receiverMemberId,
      );
      const amountMinor = BigInt(input.amountMinor);
      const overAmount = amountMinor - currentPayable;
      if (overAmount > 0n && !input.confirmOverSettlement) {
        throw new ApplicationError(
          "OVER_SETTLEMENT_CONFIRMATION_REQUIRED",
          `本次支付比当前应付多 ${formatMoney(
            {
              currency: asCurrencyCode(authorization.activity.baseCurrency),
              amountMinor: overAmount,
            },
            "zh-CN",
          )}，保存后可能产生新的反向余额`,
          409,
          {
            currentPayableMinor: currentPayable.toString(),
            overAmountMinor: overAmount.toString(),
          },
        );
      }
      const settlement = await this.repository.insert(transaction, {
        ...input,
        activityId,
        currency: authorization.activity.baseCurrency,
        createdByMemberId: authorization.member.id,
      });
      await this.repository.insertAudit(transaction, {
        activityId,
        actorUserId: authorization.userId,
        actorMemberId: authorization.member.id,
        targetId: settlement.id,
      });
      await this.repository.incrementRevision(transaction, activityId);
      return { settlement };
    });
  }
}

/** 仅在付款方实际欠款且收款方实际应收时形成该方向可抵扣金额。 */
function payableFromTo(
  balances: readonly LedgerBalance[],
  payerMemberId: string,
  receiverMemberId: string,
): bigint {
  const payer =
    balances.find((row) => row.memberId === payerMemberId)?.netMinor ?? 0n;
  const receiver =
    balances.find((row) => row.memberId === receiverMemberId)?.netMinor ?? 0n;
  return payer < 0n && receiver > 0n
    ? -payer < receiver
      ? -payer
      : receiver
    : 0n;
}
