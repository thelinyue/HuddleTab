import { randomUUID } from "node:crypto";

import type postgres from "postgres";

import type { CreateExpenseRequest } from "@/features/expenses/contracts";
import type { prepareExpense } from "@/domain/expenses/prepare-expense";

type PreparedExpense = ReturnType<typeof prepareExpense>;

export class ExpenseRepository {
  async findByCreatorMutation(
    transaction: postgres.TransactionSql,
    userId: string,
    mutationId: string,
  ) {
    const [expense] =
      await transaction`select * from expenses where created_by_user_id = ${userId} and client_mutation_id = ${mutationId}`;
    return expense ?? null;
  }

  async insertAggregate(
    transaction: postgres.TransactionSql,
    input: {
      readonly activityId: string;
      readonly baseCurrency: string;
      readonly createdByUserId: string;
      readonly createdByMemberId: string;
      readonly request: CreateExpenseRequest;
      readonly prepared: PreparedExpense;
    },
  ) {
    const memberIds = [
      ...input.prepared.payments.map((row) => row.memberId),
      ...input.prepared.shares.map((row) => row.memberId),
    ];
    for (const memberId of memberIds) {
      const [member] =
        await transaction`select id from activity_members where id = ${memberId} and activity_id = ${input.activityId} and status = 'ACTIVE'`;
      if (!member) throw new Error("付款人和承担人必须是活动中的有效成员");
    }

    const id = randomUUID();
    const splitMode = input.request.split.mode;
    const [expense] =
      await transaction`insert into expenses (id, activity_id, title, category, original_currency, original_amount_minor, base_currency, base_amount_minor, exchange_rate, exchange_rate_source, exchange_rate_at, split_mode, occurred_at, note, created_by_member_id, created_by_user_id, client_mutation_id, version)
        values (${id}, ${input.activityId}, ${input.request.title}, ${input.request.category}, ${input.request.originalCurrency}, ${input.request.originalAmountMinor}, ${input.baseCurrency}, ${input.prepared.baseAmountMinor.toString()}, ${input.request.exchangeRate}, ${input.request.exchangeRateSource}, ${new Date(input.request.exchangeRateAt)}, ${splitMode}, ${new Date(input.request.occurredAt)}, ${input.request.note ?? null}, ${input.createdByMemberId}, ${input.createdByUserId}, ${input.request.clientMutationId}, 1)
        on conflict (created_by_user_id, client_mutation_id) do nothing
        returning *`;
    if (!expense) return null;
    for (const payment of input.prepared.payments) {
      await transaction`insert into expense_payments (expense_id, activity_member_id, original_amount_minor, base_amount_minor)
        values (${id}, ${payment.memberId}, ${payment.originalAmountMinor.toString()}, ${payment.baseAmountMinor.toString()})`;
    }
    for (const share of input.prepared.shares) {
      await transaction`insert into expense_shares (expense_id, activity_member_id, split_input_minor, original_amount_minor, base_amount_minor)
        values (${id}, ${share.memberId}, ${share.splitInputMinor?.toString() ?? null}, ${share.originalAmountMinor.toString()}, ${share.baseAmountMinor.toString()})`;
    }
    return expense;
  }

  async insertAudit(
    transaction: postgres.TransactionSql,
    input: {
      activityId: string;
      actorUserId: string;
      actorMemberId: string;
      targetId: string;
    },
  ): Promise<void> {
    await transaction`insert into activity_audit_logs (id, activity_id, actor_user_id, actor_member_id, event_type, target_type, target_id, metadata)
      values (${randomUUID()}, ${input.activityId}, ${input.actorUserId}, ${input.actorMemberId}, 'EXPENSE_CREATED', 'EXPENSE', ${input.targetId}, '{}'::jsonb)`;
  }

  async incrementRevision(
    transaction: postgres.TransactionSql,
    activityId: string,
  ) {
    await transaction`update activities set revision = revision + 1, updated_at = now() where id = ${activityId}`;
  }
}
