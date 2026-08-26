import type postgres from "postgres";

import { prepareExpense } from "@/domain/expenses/prepare-expense";
import type {
  CreateExpenseRequest,
  ExpenseListQuery,
  UpdateExpenseRequest,
} from "@/features/expenses/contracts";
import { ApplicationError } from "@/server/errors/application-error";
import {
  authorizeActivityOperation,
  evaluateActivityOperation,
} from "@/server/permissions/authorize-activity-operation";
import { ExpenseRepository } from "@/server/repositories/expense-repository";

function stringIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * Expense 创建的唯一写入口。幂等键在授权之后、所有副作用之前查询；唯一冲突后
 * 再次读取，以覆盖并发请求同时通过首次查询的竞争窗口。
 */
export class ExpenseService {
  private readonly repository = new ExpenseRepository();

  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  async list(
    session: { readonly user: { readonly id: string } } | null,
    activityId: string,
    query: ExpenseListQuery,
  ) {
    return this.sql.begin(async (transaction) => {
      const authorization = await authorizeActivityOperation(transaction, {
        session,
        activityId,
        operation: "LEDGER_READ",
      });
      return this.repository.list(transaction, {
        ...query,
        activityId,
        memberId: authorization.member.id,
      });
    });
  }

  async get(
    session: { readonly user: { readonly id: string } } | null,
    activityId: string,
    expenseId: string,
  ) {
    return this.sql.begin(async (transaction) => {
      const authorization = await authorizeActivityOperation(transaction, {
        session,
        activityId,
        operation: "LEDGER_READ",
      });
      const detail = await this.repository.findDetail(
        transaction,
        activityId,
        expenseId,
      );
      const canMutate = (() => {
        try {
          evaluateActivityOperation(
            {
              hasSession: true,
              membershipExists: true,
              lifecycle: authorization.activity.status,
              memberStatus: authorization.member.status,
              role: authorization.member.role,
              ownsResource:
                (detail.expense as Record<string, unknown>)
                  .created_by_member_id === authorization.member.id,
            },
            "EXPENSE_UPDATE",
          );
          return true;
        } catch (error) {
          if (error instanceof ApplicationError) return false;
          throw error;
        }
      })();
      return {
        ...detail,
        permissions: { canUpdate: canMutate, canDelete: canMutate },
      };
    });
  }

  /**
   * 表单上下文遵循普通账务读取授权，且仅返回 ACTIVE 成员的账务身份和当前用户
   * 的活动偏好。这里不关联 User，防止快速记账入口无意暴露邮箱或系统角色。
   */
  async getEntryContext(
    session: { readonly user: { readonly id: string } } | null,
    activityId: string,
  ) {
    return this.sql.begin(async (transaction) => {
      const authorization = await authorizeActivityOperation(transaction, {
        session,
        activityId,
        operation: "READ",
      });
      const [preference] =
        await transaction`select last_category, recent_participant_ids, recent_payer_ids, recent_currency from user_activity_preferences where user_id = ${authorization.userId} and activity_id = ${activityId}`;
      const members =
        await transaction`select id, display_name, status from activity_members where activity_id = ${activityId} and status = 'ACTIVE' order by id`;
      const recentTitles =
        await transaction`select title from expenses where activity_id = ${activityId} and deleted_at is null group by title order by max(created_at) desc, title asc limit 6`;
      const canCreateExpense = (() => {
        try {
          evaluateActivityOperation(
            {
              hasSession: true,
              membershipExists: true,
              lifecycle: authorization.activity.status,
              memberStatus: authorization.member.status,
              role: authorization.member.role,
              ownsResource: true,
            },
            "EXPENSE_CREATE",
          );
          return true;
        } catch (error) {
          if (error instanceof ApplicationError) return false;
          throw error;
        }
      })();
      return {
        activity: {
          id: activityId,
          baseCurrency: authorization.activity.baseCurrency,
          currentMemberId: authorization.member.id,
        },
        members: members.map((member) => ({
          id: member.id,
          displayName: member.display_name,
          status: member.status,
        })),
        preference: {
          lastCategory: preference?.last_category ?? null,
          recentParticipantIds: stringIds(preference?.recent_participant_ids),
          recentPayerIds: stringIds(preference?.recent_payer_ids),
          recentCurrency: preference?.recent_currency ?? null,
          recentTitles: recentTitles.map((row) => row.title),
        },
        permissions: { canCreateExpense },
      };
    });
  }

  async create(
    session: { readonly user: { readonly id: string } } | null,
    activityId: string,
    request: CreateExpenseRequest,
  ) {
    return this.sql.begin(async (transaction) => {
      const authorization = await authorizeActivityOperation(transaction, {
        session,
        activityId,
        operation: "EXPENSE_CREATE",
      });
      const existing = await this.repository.findByCreatorMutation(
        transaction,
        authorization.userId,
        request.clientMutationId,
      );
      if (existing) return { expense: existing, idempotentReplay: true };

      const prepared = prepareExpense({
        originalCurrency: request.originalCurrency,
        baseCurrency: authorization.activity.baseCurrency,
        originalAmountMinor: BigInt(request.originalAmountMinor),
        exchangeRate: request.exchangeRate,
        payments: request.payments.map((row) => ({
          memberId: row.memberId,
          amountMinor: BigInt(row.amountMinor),
        })),
        split:
          request.split.mode === "EQUAL"
            ? { mode: "EQUAL", members: request.split.members }
            : {
                mode: request.split.mode,
                entries: request.split.entries.map((entry) => ({
                  memberId: entry.memberId,
                  value: BigInt(entry.value),
                })),
              },
      });
      const expense = await this.repository.insertAggregate(transaction, {
        activityId,
        baseCurrency: authorization.activity.baseCurrency,
        createdByUserId: authorization.userId,
        createdByMemberId: authorization.member.id,
        request,
        prepared,
      });
      if (!expense) {
        const replay = await this.repository.findByCreatorMutation(
          transaction,
          authorization.userId,
          request.clientMutationId,
        );
        if (!replay) throw new Error("消费幂等重放读取失败，请重试。");
        return { expense: replay, idempotentReplay: true };
      }
      await this.repository.insertAudit(transaction, {
        activityId,
        actorUserId: authorization.userId,
        actorMemberId: authorization.member.id,
        targetId: expense.id,
      });
      await this.repository.incrementRevision(transaction, activityId);
      await this.saveQuickEntryPreference(
        transaction,
        authorization.userId,
        activityId,
        request,
      );
      return { expense, idempotentReplay: false };
    });
  }

  async update(
    session: { readonly user: { readonly id: string } } | null,
    activityId: string,
    expenseId: string,
    request: UpdateExpenseRequest,
  ) {
    return this.sql.begin(async (transaction) => {
      const current = await this.repository.requireAggregate(
        transaction,
        activityId,
        expenseId,
      );
      const authorization = await authorizeActivityOperation(transaction, {
        session,
        activityId,
        operation: "EXPENSE_UPDATE",
        resourceOwnerMemberId: current.created_by_member_id,
      });
      const prepared = this.prepare(
        request,
        authorization.activity.baseCurrency,
      );
      const updated = await this.repository.updateWhereVersion(transaction, {
        expenseId,
        version: request.version,
        request,
        baseCurrency: authorization.activity.baseCurrency,
        prepared,
      });
      if (!updated)
        throw new ApplicationError(
          "VERSION_CONFLICT",
          "这笔消费已被其他人修改，请刷新后重试",
          409,
        );
      await this.repository.replacePaymentsAndShares(
        transaction,
        activityId,
        expenseId,
        prepared,
      );
      await this.repository.insertAudit(transaction, {
        activityId,
        actorUserId: authorization.userId,
        actorMemberId: authorization.member.id,
        targetId: expenseId,
        eventType: "EXPENSE_UPDATED",
      });
      await this.repository.incrementRevision(transaction, activityId);
      return updated;
    });
  }

  async remove(
    session: { readonly user: { readonly id: string } } | null,
    activityId: string,
    expenseId: string,
    version: number,
  ): Promise<void> {
    await this.sql.begin(async (transaction) => {
      const current = await this.repository.requireAggregate(
        transaction,
        activityId,
        expenseId,
      );
      const authorization = await authorizeActivityOperation(transaction, {
        session,
        activityId,
        operation: "EXPENSE_DELETE",
        resourceOwnerMemberId: current.created_by_member_id,
      });
      const removed = await this.repository.softDeleteWhereVersion(
        transaction,
        expenseId,
        version,
        authorization.member.id,
      );
      if (!removed)
        throw new ApplicationError(
          "VERSION_CONFLICT",
          "这笔消费已被其他人修改或删除，请刷新后重试",
          409,
        );
      await this.repository.insertAudit(transaction, {
        activityId,
        actorUserId: authorization.userId,
        actorMemberId: authorization.member.id,
        targetId: expenseId,
        eventType: "EXPENSE_DELETED",
      });
      await this.repository.incrementRevision(transaction, activityId);
    });
  }

  private prepare(request: CreateExpenseRequest, baseCurrency: string) {
    return prepareExpense({
      originalCurrency: request.originalCurrency,
      baseCurrency,
      originalAmountMinor: BigInt(request.originalAmountMinor),
      exchangeRate: request.exchangeRate,
      payments: request.payments.map((row) => ({
        memberId: row.memberId,
        amountMinor: BigInt(row.amountMinor),
      })),
      split:
        request.split.mode === "EQUAL"
          ? { mode: "EQUAL", members: request.split.members }
          : {
              mode: request.split.mode,
              entries: request.split.entries.map((entry) => ({
                memberId: entry.memberId,
                value: BigInt(entry.value),
              })),
            },
    });
  }

  /** 只在新的成功写入后更新偏好；幂等重放不能倒退或重复写入用户的最近选择。 */
  private async saveQuickEntryPreference(
    transaction: postgres.TransactionSql,
    userId: string,
    activityId: string,
    request: CreateExpenseRequest,
  ): Promise<void> {
    const participantIds =
      request.split.mode === "EQUAL"
        ? request.split.members
        : request.split.entries.map((entry) => entry.memberId);
    await transaction`insert into user_activity_preferences (user_id, activity_id, last_category, recent_participant_ids, recent_payer_ids, recent_currency, updated_at)
      values (${userId}, ${activityId}, ${request.category}, ${JSON.stringify(participantIds)}::jsonb, ${JSON.stringify(request.payments.map((payment) => payment.memberId))}::jsonb, ${request.originalCurrency}, now())
      on conflict (user_id, activity_id) do update set last_category = excluded.last_category, recent_participant_ids = excluded.recent_participant_ids, recent_payer_ids = excluded.recent_payer_ids, recent_currency = excluded.recent_currency, updated_at = now()`;
  }
}
