import type { LedgerBalance } from "@/domain/ledger/ledger";

export interface SettlementRecommendation {
  readonly payerMemberId: string;
  readonly receiverMemberId: string;
  readonly amountMinor: bigint;
}

interface WorkingBalance {
  readonly memberId: string;
  remainingMinor: bigint;
}

/**
 * 最大余额优先排序；余额相同时使用 ActivityMember ID 保证推荐稳定，
 * 不受传入顺序、昵称或 UI 展示顺序影响。
 */
function compareLargestFirst(
  left: WorkingBalance,
  right: WorkingBalance,
): number {
  if (left.remainingMinor === right.remainingMinor) {
    return left.memberId.localeCompare(right.memberId);
  }

  return left.remainingMinor > right.remainingMinor ? -1 : 1;
}

/**
 * 根据当前总账生成瞬时结算建议。建议不是 Settlement 事实，不保存也不表示已经付款；
 * 每次都必须由当前零和余额重新计算。
 */
export function recommendSettlements(
  balances: readonly LedgerBalance[],
): SettlementRecommendation[] {
  const balanceTotal = balances.reduce(
    (sum, balance) => sum + balance.netMinor,
    0n,
  );
  if (balanceTotal !== 0n) {
    throw new Error("成员余额合计必须为零");
  }

  const creditors = balances
    .filter((balance) => balance.netMinor > 0n)
    .map((balance) => ({
      memberId: balance.memberId,
      remainingMinor: balance.netMinor,
    }));
  const debtors = balances
    .filter((balance) => balance.netMinor < 0n)
    .map((balance) => ({
      memberId: balance.memberId,
      remainingMinor: -balance.netMinor,
    }));
  const recommendations: SettlementRecommendation[] = [];

  while (creditors.length > 0 && debtors.length > 0) {
    creditors.sort(compareLargestFirst);
    debtors.sort(compareLargestFirst);

    const creditor = creditors[0];
    const debtor = debtors[0];
    const amountMinor =
      creditor.remainingMinor < debtor.remainingMinor
        ? creditor.remainingMinor
        : debtor.remainingMinor;

    recommendations.push({
      payerMemberId: debtor.memberId,
      receiverMemberId: creditor.memberId,
      amountMinor,
    });
    creditor.remainingMinor -= amountMinor;
    debtor.remainingMinor -= amountMinor;

    if (creditor.remainingMinor === 0n) creditors.shift();
    if (debtor.remainingMinor === 0n) debtors.shift();
  }

  return recommendations;
}
