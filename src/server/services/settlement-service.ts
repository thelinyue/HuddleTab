import type postgres from "postgres";

import type { CreateSettlementRequest } from "@/features/settlements/contracts";
import { authorizeActivityOperation } from "@/server/permissions/authorize-activity-operation";
import { SettlementRepository } from "@/server/repositories/settlement-repository";

/**
 * 真实结算的唯一写入口。权限判断始终先于成员事实写入；后续超额确认和版本更新
 * 也必须复用此入口，不能让 Route Handler 直接操作 settlements 表。
 */
export class SettlementService {
  private readonly repository = new SettlementRepository();

  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  async create(
    session: { readonly user: { readonly id: string } } | null,
    activityId: string,
    input: CreateSettlementRequest,
  ) {
    return this.sql.begin(async (transaction) => {
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
