export interface MemberBalance {
  readonly memberId: string;
  readonly netMinor: bigint;
}

export interface LedgerInput {
  readonly memberIds: readonly string[];
  readonly payments: readonly { memberId: string; amountMinor: bigint }[];
  readonly shares: readonly { memberId: string; amountMinor: bigint }[];
  readonly settlements: readonly {
    payerMemberId: string;
    receiverMemberId: string;
    amountMinor: bigint;
  }[];
}

/**
 * Ledger 每次都从未删除的 payment、share 与 settlement 事实重新计算，绝不存在可编辑
 * 的 user_balance 表，也不得持久化余额。ActivityMember ID 是稳定账务身份，余额结果
 * 以不依赖运行 locale 的 Unicode 代码点顺序输出，避免展示环境改变账务结果。
 */
export function calculateLedger(input: LedgerInput): MemberBalance[] {
  const memberIds = new Set<string>();
  for (const memberId of input.memberIds) {
    if (memberIds.has(memberId)) {
      throw new Error("总账成员不能重复");
    }

    memberIds.add(memberId);
  }

  const values = new Map(input.memberIds.map((memberId) => [memberId, 0n]));
  const change = (memberId: string, delta: bigint): void => {
    if (!values.has(memberId)) {
      throw new Error(`账务事实引用了未知成员：${memberId}`);
    }

    values.set(memberId, values.get(memberId)! + delta);
  };

  // 守恒只验证余额总和；负金额方向、自结算和重复成员仍可能让总和为零，必须先校验。
  for (const payment of input.payments) {
    if (payment.amountMinor < 0n) {
      throw new Error("付款金额不能为负数");
    }

    change(payment.memberId, payment.amountMinor);
  }
  for (const share of input.shares) {
    if (share.amountMinor < 0n) {
      throw new Error("分摊金额不能为负数");
    }

    change(share.memberId, -share.amountMinor);
  }
  for (const settlement of input.settlements) {
    if (settlement.amountMinor <= 0n) {
      throw new Error("结算金额必须大于零");
    }
    if (settlement.payerMemberId === settlement.receiverMemberId) {
      throw new Error("结算付款人与收款人不能相同");
    }

    change(settlement.payerMemberId, settlement.amountMinor);
    change(settlement.receiverMemberId, -settlement.amountMinor);
  }

  const result = [...values].map(([memberId, netMinor]) => ({
    memberId,
    netMinor,
  }));

  if (result.reduce((sum, balance) => sum + balance.netMinor, 0n) !== 0n) {
    throw new Error("账务事实不守恒，无法生成总账");
  }

  return result.sort((left, right) =>
    compareMemberIds(left.memberId, right.memberId),
  );
}

/**
 * 使用最小确定性的 Unicode 代码点比较，不调用 localeCompare，确保不同部署环境的
 * locale 设置不会影响总账行的稳定顺序。
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
