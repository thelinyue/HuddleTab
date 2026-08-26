import { randomUUID } from "node:crypto";

import type postgres from "postgres";

import type {
  CreateExpenseRequest,
  ExpenseListQuery,
} from "@/features/expenses/contracts";
import type { prepareExpense } from "@/domain/expenses/prepare-expense";
import { ApplicationError } from "@/server/errors/application-error";

type PreparedExpense = ReturnType<typeof prepareExpense>;

/**
 * 消费事实的持久化边界。所有方法只负责同一事务内的数据库读写；成员、权限和
 * 账务计算由调用方和 Domain 层决定，但写入前仍要守住活动账务身份不能跨活动的约束。
 */
export class ExpenseRepository {
  async list(
    transaction: postgres.TransactionSql,
    input: ExpenseListQuery & {
      readonly activityId: string;
      readonly memberId: string;
    },
  ) {
    const titleQuery = input.query ? `%${input.query}%` : null;
    const category = input.category ?? null;
    return transaction`select expense.*,
        coalesce((select string_agg(member.display_name, '、' order by payment.activity_member_id)
          from expense_payments payment join activity_members member on member.id = payment.activity_member_id
          where payment.expense_id = expense.id), '') as payer_summary,
        (select count(*)::int from expense_shares share where share.expense_id = expense.id) as participant_count
      from expenses expense
      where expense.activity_id = ${input.activityId}
        and expense.deleted_at is null
        and (${titleQuery}::text is null or expense.title ilike ${titleQuery})
        and (${category}::expense_category is null or expense.category = ${category}::expense_category)
        and (
          ${input.mine} = false
          or exists (
            select 1 from expense_payments payment
            where payment.expense_id = expense.id and payment.activity_member_id = ${input.memberId}
          )
          or exists (
            select 1 from expense_shares share
            where share.expense_id = expense.id and share.activity_member_id = ${input.memberId}
          )
        )
      order by expense.occurred_at desc, expense.id desc`;
  }

  async findDetail(
    transaction: postgres.TransactionSql,
    activityId: string,
    expenseId: string,
  ) {
    const expense = await this.requireAggregate(
      transaction,
      activityId,
      expenseId,
    );
    const [creator] =
      await transaction`select display_name from activity_members where id = ${expense.created_by_member_id}`;
    const payments =
      await transaction`select payment.*, member.display_name as member_display_name
      from expense_payments payment join activity_members member on member.id = payment.activity_member_id
      where payment.expense_id = ${expenseId}
      order by payment.activity_member_id`;
    const shares =
      await transaction`select share.*, member.display_name as member_display_name
      from expense_shares share join activity_members member on member.id = share.activity_member_id
      where share.expense_id = ${expenseId}
      order by share.activity_member_id`;
    const attachments =
      await transaction`select id, safe_filename, mime_type, width, height, byte_size, sha256, created_at
      from expense_attachments where expense_id = ${expenseId} order by created_at asc, id asc`;
    return {
      expense: { ...expense, created_by_display_name: creator?.display_name },
      payments,
      shares,
      attachments,
    };
  }

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
        values (${id}, ${input.activityId}, ${input.request.title}, ${input.request.category}, ${input.request.originalCurrency}, ${input.request.originalAmountMinor}, ${input.baseCurrency}, ${input.prepared.baseAmountMinor.toString()}, ${input.request.exchangeRate}, ${input.request.exchangeRateSource}, ${input.request.exchangeRateAt}, ${splitMode}, ${input.request.occurredAt}, ${input.request.note ?? null}, ${input.createdByMemberId}, ${input.createdByUserId}, ${input.request.clientMutationId}, 1)
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
      eventType?: "EXPENSE_CREATED" | "EXPENSE_UPDATED" | "EXPENSE_DELETED";
    },
  ): Promise<void> {
    await transaction`insert into activity_audit_logs (id, activity_id, actor_user_id, actor_member_id, event_type, target_type, target_id, metadata)
      values (${randomUUID()}, ${input.activityId}, ${input.actorUserId}, ${input.actorMemberId}, ${input.eventType ?? "EXPENSE_CREATED"}, 'EXPENSE', ${input.targetId}, '{}'::jsonb)`;
  }

  async incrementRevision(
    transaction: postgres.TransactionSql,
    activityId: string,
  ) {
    await transaction`update activities set revision = revision + 1, updated_at = now() where id = ${activityId}`;
  }

  async requireAggregate(
    transaction: postgres.TransactionSql,
    activityId: string,
    expenseId: string,
  ) {
    const [expense] =
      await transaction`select * from expenses where id = ${expenseId} and activity_id = ${activityId} and deleted_at is null`;
    if (!expense) {
      throw new ApplicationError(
        "EXPENSE_NOT_FOUND",
        "消费不存在或你无权查看。",
        404,
      );
    }
    return expense;
  }

  async updateWhereVersion(
    transaction: postgres.TransactionSql,
    input: {
      expenseId: string;
      version: number;
      request: CreateExpenseRequest;
      baseCurrency: string;
      prepared: PreparedExpense;
    },
  ) {
    const [expense] =
      await transaction`update expenses set title = ${input.request.title}, category = ${input.request.category}, original_currency = ${input.request.originalCurrency}, original_amount_minor = ${input.request.originalAmountMinor}, base_currency = ${input.baseCurrency}, base_amount_minor = ${input.prepared.baseAmountMinor.toString()}, exchange_rate = ${input.request.exchangeRate}, exchange_rate_source = ${input.request.exchangeRateSource}, exchange_rate_at = ${input.request.exchangeRateAt}, split_mode = ${input.request.split.mode}, occurred_at = ${input.request.occurredAt}, note = ${input.request.note ?? null}, version = version + 1, updated_at = now() where id = ${input.expenseId} and version = ${input.version} and deleted_at is null returning *`;
    return expense ?? null;
  }

  async replacePaymentsAndShares(
    transaction: postgres.TransactionSql,
    activityId: string,
    expenseId: string,
    prepared: PreparedExpense,
  ) {
    await this.requireActiveMembers(transaction, activityId, prepared);
    await transaction`delete from expense_payments where expense_id = ${expenseId}`;
    await transaction`delete from expense_shares where expense_id = ${expenseId}`;
    for (const payment of prepared.payments) {
      await transaction`insert into expense_payments (expense_id, activity_member_id, original_amount_minor, base_amount_minor)
        values (${expenseId}, ${payment.memberId}, ${payment.originalAmountMinor.toString()}, ${payment.baseAmountMinor.toString()})`;
    }
    for (const share of prepared.shares) {
      await transaction`insert into expense_shares (expense_id, activity_member_id, split_input_minor, original_amount_minor, base_amount_minor)
        values (${expenseId}, ${share.memberId}, ${share.splitInputMinor?.toString() ?? null}, ${share.originalAmountMinor.toString()}, ${share.baseAmountMinor.toString()})`;
    }
  }

  /** 更新前重查全部账务身份，避免仅有外键时把其他活动或已退出成员写入子表。 */
  private async requireActiveMembers(
    transaction: postgres.TransactionSql,
    activityId: string,
    prepared: PreparedExpense,
  ): Promise<void> {
    const memberIds = new Set([
      ...prepared.payments.map((row) => row.memberId),
      ...prepared.shares.map((row) => row.memberId),
    ]);
    for (const memberId of memberIds) {
      const [member] =
        await transaction`select id from activity_members where id = ${memberId} and activity_id = ${activityId} and status = 'ACTIVE'`;
      if (!member) {
        throw new ApplicationError(
          "INVALID_EXPENSE_MEMBER",
          "付款人和承担人必须是活动中的有效成员。",
          422,
        );
      }
    }
  }

  async softDeleteWhereVersion(
    transaction: postgres.TransactionSql,
    expenseId: string,
    version: number,
    memberId: string,
  ) {
    const [expense] =
      await transaction`update expenses set deleted_at = now(), deleted_by_member_id = ${memberId}, version = version + 1, updated_at = now() where id = ${expenseId} and version = ${version} and deleted_at is null returning *`;
    return expense ?? null;
  }
}
