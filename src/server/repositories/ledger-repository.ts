import type postgres from "postgres";

/** 读取总账的原始事实，绝不查询或写入可编辑余额。 */
export class LedgerRepository {
  async loadFacts(transaction: postgres.TransactionSql, activityId: string) {
    const members =
      await transaction`select id from activity_members where activity_id = ${activityId} and status in ('ACTIVE', 'LEFT') order by id`;
    const payments =
      await transaction`select payment.activity_member_id, payment.base_amount_minor
        from expense_payments payment join expenses expense on expense.id = payment.expense_id
        where expense.activity_id = ${activityId} and expense.deleted_at is null`;
    const shares =
      await transaction`select share.activity_member_id, share.base_amount_minor
        from expense_shares share join expenses expense on expense.id = share.expense_id
        where expense.activity_id = ${activityId} and expense.deleted_at is null`;
    const settlements =
      await transaction`select payer_member_id, receiver_member_id, amount_minor from settlements
        where activity_id = ${activityId} and deleted_at is null`;
    return {
      memberIds: members.map((row) => row.id),
      payments: payments.map((row) => ({
        memberId: row.activity_member_id,
        amountMinor: BigInt(row.base_amount_minor),
      })),
      shares: shares.map((row) => ({
        memberId: row.activity_member_id,
        amountMinor: BigInt(row.base_amount_minor),
      })),
      settlements: settlements.map((row) => ({
        payerMemberId: row.payer_member_id,
        receiverMemberId: row.receiver_member_id,
        amountMinor: BigInt(row.amount_minor),
      })),
    };
  }
}
