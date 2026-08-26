import type postgres from "postgres";

import { prepareExpense } from "@/domain/expenses/prepare-expense";
import type { CreateExpenseRequest } from "@/features/expenses/contracts";
import { authorizeActivityOperation } from "@/server/permissions/authorize-activity-operation";
import { ExpenseRepository } from "@/server/repositories/expense-repository";

/**
 * Expense 创建的唯一写入口。幂等键在授权之后、所有副作用之前查询；唯一冲突后
 * 再次读取，以覆盖并发请求同时通过首次查询的竞争窗口。
 */
export class ExpenseService {
  private readonly repository = new ExpenseRepository();

  constructor(private readonly sql: ReturnType<typeof postgres>) {}

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
      return { expense, idempotentReplay: false };
    });
  }
}
