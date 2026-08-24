import type { MemberBalance } from "@/domain/ledger/ledger";

/**
 * 一笔基于当前总账余额计算出的结算建议。
 *
 * 该对象只是瞬时的只读视图：它既不会持久化，也不代表成员已经完成现实付款。实际
 * Settlement 事实必须由后续流程单独创建和校验。
 */
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
 * 从总账余额生成确定性的结算建议。每轮选取剩余金额最大的债务人与债权人；金额为
 * 两者剩余金额的较小值。相同余额始终按 memberId 的 Unicode 代码点顺序选择，因而
 * 不受输入顺序和部署环境 locale 的影响。函数只创建工作副本，绝不修改账本输入。
 */
export function recommendSettlements(
  balances: readonly MemberBalance[],
): SettlementRecommendation[] {
  // recommendation 只接受每位成员一行的 Ledger 输出，先阻止重复 ID 形成自我付款。
  const memberIds = new Set<string>();
  let total = 0n;
  for (const balance of balances) {
    if (memberIds.has(balance.memberId)) {
      throw new Error("成员余额不能重复");
    }

    memberIds.add(balance.memberId);
    total += balance.netMinor;
  }

  if (total !== 0n) {
    throw new Error("成员余额合计必须为零");
  }

  const debtors: WorkingBalance[] = [];
  const creditors: WorkingBalance[] = [];

  for (const balance of balances) {
    if (balance.netMinor < 0n) {
      debtors.push({
        memberId: balance.memberId,
        remainingMinor: -balance.netMinor,
      });
    } else if (balance.netMinor > 0n) {
      creditors.push({
        memberId: balance.memberId,
        remainingMinor: balance.netMinor,
      });
    }
  }

  const recommendations: SettlementRecommendation[] = [];
  while (debtors.length > 0) {
    debtors.sort(compareWorkingBalances);
    creditors.sort(compareWorkingBalances);

    const debtor = debtors[0]!;
    const creditor = creditors[0]!;
    const amountMinor =
      debtor.remainingMinor < creditor.remainingMinor
        ? debtor.remainingMinor
        : creditor.remainingMinor;

    recommendations.push({
      payerMemberId: debtor.memberId,
      receiverMemberId: creditor.memberId,
      amountMinor,
    });

    debtor.remainingMinor -= amountMinor;
    creditor.remainingMinor -= amountMinor;

    if (debtor.remainingMinor === 0n) {
      debtors.shift();
    }
    if (creditor.remainingMinor === 0n) {
      creditors.shift();
    }
  }

  return recommendations;
}

function compareWorkingBalances(
  left: WorkingBalance,
  right: WorkingBalance,
): number {
  if (left.remainingMinor !== right.remainingMinor) {
    return left.remainingMinor > right.remainingMinor ? -1 : 1;
  }

  return compareMemberIds(left.memberId, right.memberId);
}

/**
 * 使用最小确定性的 Unicode 代码点比较，不调用 localeCompare，确保 locale 配置不会
 * 改变余额相同成员的结算顺序。
 */
function compareMemberIds(left: string, right: string): number {
  const leftCodePoints = Array.from(left);
  const rightCodePoints = Array.from(right);
  const sharedLength = Math.min(leftCodePoints.length, rightCodePoints.length);

  for (let index = 0; index < sharedLength; index += 1) {
    const leftCodePoint = leftCodePoints[index].codePointAt(0)!;
    const rightCodePoint = rightCodePoints[index].codePointAt(0)!;

    if (leftCodePoint !== rightCodePoint) {
      return leftCodePoint < rightCodePoint ? -1 : 1;
    }
  }

  return leftCodePoints.length - rightCodePoints.length;
}
