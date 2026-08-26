export interface LedgerInput {
  readonly memberIds: readonly string[];
  readonly payments: readonly {
    readonly memberId: string;
    readonly amountMinor: bigint;
  }[];
  readonly shares: readonly {
    readonly memberId: string;
    readonly amountMinor: bigint;
  }[];
  readonly settlements: readonly {
    readonly payerMemberId: string;
    readonly receiverMemberId: string;
    readonly amountMinor: bigint;
  }[];
}

export interface LedgerBalance {
  readonly memberId: string;
  readonly netMinor: bigint;
}

/**
 * 总账从不可变事实实时推导，不保存可被直接修改的余额。
 * 每笔消费的付款与承担必须守恒；实际结算只在成员间移动净额，因此不改变总和。
 */
export function calculateLedger(input: LedgerInput): LedgerBalance[] {
  const memberIds = [...input.memberIds].sort();

  if (memberIds.length === 0 || new Set(memberIds).size !== memberIds.length) {
    throw new Error("账务成员必须存在且不能重复");
  }

  const balances = new Map(memberIds.map((memberId) => [memberId, 0n]));
  const adjust = (memberId: string, amountMinor: bigint) => {
    const current = balances.get(memberId);
    if (current === undefined) {
      throw new Error("账务成员不存在");
    }
    balances.set(memberId, current + amountMinor);
  };
  const paymentTotal = input.payments.reduce(
    (sum, payment) => sum + payment.amountMinor,
    0n,
  );
  const shareTotal = input.shares.reduce(
    (sum, share) => sum + share.amountMinor,
    0n,
  );

  if (paymentTotal !== shareTotal) {
    throw new Error("账务事实不守恒，无法生成总账");
  }

  for (const payment of input.payments) {
    adjust(payment.memberId, payment.amountMinor);
  }
  for (const share of input.shares) {
    adjust(share.memberId, -share.amountMinor);
  }
  for (const settlement of input.settlements) {
    adjust(settlement.payerMemberId, settlement.amountMinor);
    adjust(settlement.receiverMemberId, -settlement.amountMinor);
  }

  return memberIds.map((memberId) => ({
    memberId,
    netMinor: balances.get(memberId) ?? 0n,
  }));
}
