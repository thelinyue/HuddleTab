import {
  allocateByWeights,
  compareMemberIds,
  type AllocationResult,
} from "./allocation";

/** 等额分摊：每位参与成员权重相同。 */
type EqualSplitInput = {
  readonly mode: "EQUAL";
  readonly totalMinor: bigint;
  readonly memberIds: readonly string[];
};

/** 指定金额分摊：每位参与成员直接给出最小货币单位金额。 */
type ExactSplitInput = {
  readonly mode: "EXACT";
  readonly totalMinor: bigint;
  readonly shares: readonly {
    readonly memberId: string;
    readonly amountMinor: bigint;
  }[];
};

/** 按基点分摊：10,000 个基点恰好对应 100.00%。 */
type PercentageSplitInput = {
  readonly mode: "PERCENTAGE";
  readonly totalMinor: bigint;
  readonly shares: readonly {
    readonly memberId: string;
    readonly basisPoints: bigint;
  }[];
};

/** 按百分之一权重分摊：具体非正权重由通用分配器统一拒绝。 */
type WeightSplitInput = {
  readonly mode: "WEIGHT";
  readonly totalMinor: bigint;
  readonly shares: readonly {
    readonly memberId: string;
    readonly weightHundredths: bigint;
  }[];
};

/**
 * 消费分摊的四种领域输入。金额均为最小货币单位整数；百分比使用基点，避免浮点数
 * 或十进制文本解析进入领域计算。
 */
export type SplitInput =
  EqualSplitInput | ExactSplitInput | PercentageSplitInput | WeightSplitInput;

/**
 * 在分摊模式边界统一校验成员集合。通用 allocator 有自己的保护，但此处保留分摊
 * 领域一致的错误信息，且 EXACT 不经过 allocator 也必须遵守相同成员约束。
 */
function assertUniqueMemberIds(memberIds: readonly string[]): void {
  if (memberIds.length === 0) {
    throw new Error("至少需要一个分摊成员");
  }
  if (new Set(memberIds).size !== memberIds.length) {
    throw new Error("分摊成员不能重复");
  }
}

/**
 * 根据选定模式把消费总额分配给成员。
 *
 * 所有按比例计算的模式都委托给 allocateByWeights，从而共享最小单位余数和稳定
 * ActivityMember ID 排序规则；EXACT 也复用同一个 ID 比较器，保证各模式输出顺序
 * 不受输入顺序或运行环境 locale 的影响。
 */
export function splitExpense(input: SplitInput): AllocationResult[] {
  if (input.totalMinor <= 0n) {
    throw new Error("消费总额必须大于零");
  }

  if (input.mode === "EQUAL") {
    assertUniqueMemberIds(input.memberIds);
    return allocateByWeights(
      input.totalMinor,
      input.memberIds.map((memberId) => ({ memberId, weight: 1n })),
    );
  }

  assertUniqueMemberIds(input.shares.map((share) => share.memberId));

  if (input.mode === "EXACT") {
    if (input.shares.some((share) => share.amountMinor < 0n)) {
      throw new Error("指定金额不能为负数");
    }
    const amountSum = input.shares.reduce(
      (sum, share) => sum + share.amountMinor,
      0n,
    );

    if (amountSum !== input.totalMinor) {
      throw new Error("指定金额合计必须等于消费总额");
    }

    return [...input.shares]
      .sort((left, right) => compareMemberIds(left.memberId, right.memberId))
      .map(({ memberId, amountMinor }) => ({ memberId, amountMinor }));
  }

  if (input.mode === "PERCENTAGE") {
    const basisPointsSum = input.shares.reduce(
      (sum, share) => sum + share.basisPoints,
      0n,
    );

    if (basisPointsSum !== 10000n) {
      throw new Error("比例合计必须等于 100.00%");
    }

    return allocateByWeights(
      input.totalMinor,
      input.shares.map((share) => ({
        memberId: share.memberId,
        weight: share.basisPoints,
      })),
    );
  }

  return allocateByWeights(
    input.totalMinor,
    input.shares.map((share) => ({
      memberId: share.memberId,
      weight: share.weightHundredths,
    })),
  );
}
