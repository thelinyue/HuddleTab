import type postgres from "postgres";

import { calculateLedger } from "@/domain/ledger/ledger";
import { recommendSettlements } from "@/domain/settlement/recommendation";
import type { ExpenseExportRow } from "@/server/export/expense-csv";
import { authorizeActivityOperation } from "@/server/permissions/authorize-activity-operation";
import { LedgerRepository } from "@/server/repositories/ledger-repository";

const dateTimeString = (value: Date | string) =>
  value instanceof Date ? value.toISOString() : value;

/**
 * 活动摘要与 CSV 的只读聚合边界。
 *
 * 两个读取模型都先完成 Ledger 权限校验，再在可重复读事务中从 Expense、支付、分摊、
 * Settlement 和 ActivityMember 账务身份取得事实。这里刻意不关联用户邮箱、附件或审计表，
 * 避免摘要、复制和导出路径意外泄漏私有资料。
 */
export class ActivitySummaryService {
  private readonly ledgerRepository = new LedgerRepository();
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  async get(
    session: { readonly user: { readonly id: string } } | null,
    activityId: string,
  ) {
    return this.sql.begin(async (transaction) => {
      await transaction`set transaction isolation level repeatable read, read only`;
      const authorization = await authorizeActivityOperation(transaction, {
        session,
        activityId,
        operation: "LEDGER_READ",
      });
      const [activity] =
        await transaction`select name, start_date, end_date from activities where id = ${activityId}`;
      const members =
        await transaction`select id, display_name from activity_members where activity_id = ${activityId} order by id`;
      const [expenseTotals] =
        await transaction`select coalesce(sum(base_amount_minor), 0)::text as total_expense_minor, count(*)::int as expense_count from expenses where activity_id = ${activityId} and deleted_at is null`;
      const [participatingMemberTotals] =
        await transaction`select count(distinct share.activity_member_id)::int as participating_member_count
          from expense_shares share
          join expenses expense on expense.id = share.expense_id
          where expense.activity_id = ${activityId} and expense.deleted_at is null`;
      const originalCurrencyTotals =
        await transaction`select original_currency, sum(original_amount_minor)::text as amount_minor from expenses where activity_id = ${activityId} and deleted_at is null group by original_currency order by original_currency`;
      const categoryTotals =
        await transaction`select category, sum(base_amount_minor)::text as amount_minor from expenses where activity_id = ${activityId} and deleted_at is null group by category order by category`;
      const ledgerRows = calculateLedger(
        await this.ledgerRepository.loadFacts(transaction, activityId),
      );
      const displayNameByMemberId = new Map(
        members.map((member) => [member.id, member.display_name]),
      );
      const balances = ledgerRows.map((row) => ({
        memberId: row.memberId,
        displayName: displayNameByMemberId.get(row.memberId) ?? "",
        netMinor: row.netMinor.toString(),
      }));
      const currentUserBalanceMinor =
        ledgerRows.find((row) => row.memberId === authorization.member.id)
          ?.netMinor ?? 0n;
      const expenseCount = Number(expenseTotals!.expense_count ?? 0);
      const participatingMemberCount = Number(
        participatingMemberTotals!.participating_member_count ?? 0,
      );
      const totalExpenseMinor = BigInt(expenseTotals!.total_expense_minor);
      const divisor = BigInt(participatingMemberCount);
      const averageExpenseMinor =
        divisor === 0n ? 0n : (totalExpenseMinor + divisor / 2n) / divisor;
      return {
        activityName: activity!.name,
        startDate: activity!.start_date,
        endDate: activity!.end_date,
        memberCount: members.length,
        totalExpenseMinor: expenseTotals!.total_expense_minor,
        expenseCount,
        participatingMemberCount,
        averageExpenseMinor: averageExpenseMinor.toString(),
        currency: authorization.activity.baseCurrency,
        revision: authorization.activity.revision.toString(),
        originalCurrencyTotals: originalCurrencyTotals.map((row) => ({
          currency: row.original_currency,
          amountMinor: row.amount_minor,
        })),
        currentUserBalanceMinor: currentUserBalanceMinor.toString(),
        balances,
        recommendations: recommendSettlements(ledgerRows).map((row) => ({
          payerMemberId: row.payerMemberId,
          receiverMemberId: row.receiverMemberId,
          amountMinor: row.amountMinor.toString(),
        })),
        categoryTotals: categoryTotals.map((row) => ({
          category: row.category,
          amountMinor: row.amount_minor,
        })),
      };
    });
  }

  async getExpenseExport(
    session: { readonly user: { readonly id: string } } | null,
    activityId: string,
  ): Promise<readonly ExpenseExportRow[]> {
    return this.sql.begin(async (transaction) => {
      await transaction`set transaction isolation level repeatable read, read only`;
      await authorizeActivityOperation(transaction, {
        session,
        activityId,
        operation: "LEDGER_READ",
      });
      const expenses =
        await transaction`select expense.id, expense.occurred_at, expense.title, expense.category, expense.original_amount_minor, expense.original_currency, expense.exchange_rate, expense.base_amount_minor, expense.split_mode, expense.created_at, expense.note, creator.display_name as creator_name
          from expenses expense
          join activity_members creator on creator.id = expense.created_by_member_id
          where expense.activity_id = ${activityId} and expense.deleted_at is null
          order by expense.occurred_at, expense.id`;
      const payments =
        await transaction`select payment.expense_id, payment.activity_member_id, payment.original_amount_minor, member.display_name
          from expense_payments payment
          join expenses expense on expense.id = payment.expense_id
          join activity_members member on member.id = payment.activity_member_id
          where expense.activity_id = ${activityId} and expense.deleted_at is null
          order by payment.expense_id, payment.activity_member_id`;
      const shares =
        await transaction`select share.expense_id, share.activity_member_id, share.original_amount_minor, member.display_name
          from expense_shares share
          join expenses expense on expense.id = share.expense_id
          join activity_members member on member.id = share.activity_member_id
          where expense.activity_id = ${activityId} and expense.deleted_at is null
          order by share.expense_id, share.activity_member_id`;
      const paymentsByExpenseId = new Map<
        string,
        Array<{ readonly name: string; readonly amount: string }>
      >();
      for (const payment of payments) {
        const values = paymentsByExpenseId.get(payment.expense_id) ?? [];
        values.push({
          name: payment.display_name,
          amount: payment.original_amount_minor.toString(),
        });
        paymentsByExpenseId.set(payment.expense_id, values);
      }
      const sharesByExpenseId = new Map<
        string,
        Array<{ readonly name: string; readonly amount: string }>
      >();
      for (const share of shares) {
        const values = sharesByExpenseId.get(share.expense_id) ?? [];
        values.push({
          name: share.display_name,
          amount: share.original_amount_minor.toString(),
        });
        sharesByExpenseId.set(share.expense_id, values);
      }
      return expenses.map((expense) => ({
        occurredAt: dateTimeString(expense.occurred_at),
        title: expense.title,
        category: expense.category,
        originalAmount: expense.original_amount_minor.toString(),
        originalCurrency: expense.original_currency,
        exchangeRate: expense.exchange_rate.toString(),
        baseAmount: expense.base_amount_minor.toString(),
        payers: paymentsByExpenseId.get(expense.id) ?? [],
        participants: sharesByExpenseId.get(expense.id) ?? [],
        splitMode: expense.split_mode,
        creatorName: expense.creator_name,
        createdAt: dateTimeString(expense.created_at),
        note: expense.note,
      }));
    });
  }
}
