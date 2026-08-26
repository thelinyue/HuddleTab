import { randomUUID } from "node:crypto";

import type postgres from "postgres";

import { ApplicationError } from "@/server/errors/application-error";

/** Settlement 事实写入边界；成员同活动与状态校验在事务内完成。 */
export class SettlementRepository {
  /** 串行化同一活动的结算写入，确保超额判断基于提交时仍有效的事实。 */
  async lockActivity(
    transaction: postgres.TransactionSql,
    activityId: string,
  ): Promise<void> {
    await transaction`select id from activities where id = ${activityId} for update`;
  }

  async requireAccountingMember(
    transaction: postgres.TransactionSql,
    activityId: string,
    memberId: string,
  ): Promise<void> {
    const [member] =
      await transaction`select id from activity_members where id = ${memberId} and activity_id = ${activityId} and status in ('ACTIVE', 'LEFT')`;
    if (!member) {
      throw new ApplicationError(
        "INVALID_SETTLEMENT_MEMBER",
        "付款人和收款人必须是活动中的账务成员。",
        422,
      );
    }
  }

  async insert(
    transaction: postgres.TransactionSql,
    input: {
      readonly activityId: string;
      readonly payerMemberId: string;
      readonly receiverMemberId: string;
      readonly amountMinor: string;
      readonly currency: string;
      readonly occurredAt: string;
      readonly note?: string;
      readonly createdByMemberId: string;
    },
  ) {
    const [settlement] =
      await transaction`insert into settlements (id, activity_id, payer_member_id, receiver_member_id, amount_minor, currency, occurred_at, note, created_by_member_id, version)
        values (${randomUUID()}, ${input.activityId}, ${input.payerMemberId}, ${input.receiverMemberId}, ${input.amountMinor}, ${input.currency}, ${new Date(input.occurredAt)}, ${input.note ?? null}, ${input.createdByMemberId}, 1)
        returning *`;
    return settlement!;
  }

  async insertAudit(
    transaction: postgres.TransactionSql,
    input: {
      readonly activityId: string;
      readonly actorUserId: string;
      readonly actorMemberId: string;
      readonly targetId: string;
      readonly eventType?:
        "SETTLEMENT_CREATED" | "SETTLEMENT_UPDATED" | "SETTLEMENT_DELETED";
    },
  ): Promise<void> {
    await transaction`insert into activity_audit_logs (id, activity_id, actor_user_id, actor_member_id, event_type, target_type, target_id, metadata)
      values (${randomUUID()}, ${input.activityId}, ${input.actorUserId}, ${input.actorMemberId}, ${input.eventType ?? "SETTLEMENT_CREATED"}, 'SETTLEMENT', ${input.targetId}, '{}'::jsonb)`;
  }

  async incrementRevision(
    transaction: postgres.TransactionSql,
    activityId: string,
  ): Promise<void> {
    await transaction`update activities set revision = revision + 1, updated_at = now() where id = ${activityId}`;
  }

  async requireCurrent(
    transaction: postgres.TransactionSql,
    activityId: string,
    settlementId: string,
  ) {
    const [settlement] =
      await transaction`select * from settlements where id = ${settlementId} and activity_id = ${activityId} and deleted_at is null`;
    if (!settlement)
      throw new ApplicationError(
        "SETTLEMENT_NOT_FOUND",
        "结算记录不存在或你无权查看。",
        404,
      );
    return settlement;
  }

  async updateWhereVersion(
    transaction: postgres.TransactionSql,
    settlementId: string,
    input: {
      version: number;
      payerMemberId: string;
      receiverMemberId: string;
      amountMinor: string;
      occurredAt: string;
      note?: string;
    },
  ) {
    const [settlement] =
      await transaction`update settlements set payer_member_id = ${input.payerMemberId}, receiver_member_id = ${input.receiverMemberId}, amount_minor = ${input.amountMinor}, occurred_at = ${new Date(input.occurredAt)}, note = ${input.note ?? null}, version = version + 1, updated_at = now() where id = ${settlementId} and version = ${input.version} and deleted_at is null returning *`;
    return settlement ?? null;
  }

  async softDeleteWhereVersion(
    transaction: postgres.TransactionSql,
    settlementId: string,
    version: number,
    memberId: string,
  ) {
    const [settlement] =
      await transaction`update settlements set deleted_at = now(), deleted_by_member_id = ${memberId}, version = version + 1, updated_at = now() where id = ${settlementId} and version = ${version} and deleted_at is null returning *`;
    return settlement ?? null;
  }
}
