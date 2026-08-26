import {
  allocateByWeights,
  type AllocationResult,
} from "@/domain/splitting/allocation";

type EqualSplit = {
  readonly mode: "EQUAL";
  readonly totalMinor: bigint;
  readonly memberIds: readonly string[];
};
type ExactSplit = {
  readonly mode: "EXACT";
  readonly totalMinor: bigint;
  readonly shares: readonly {
    readonly memberId: string;
    readonly amountMinor: bigint;
  }[];
};
type PercentageSplit = {
  readonly mode: "PERCENTAGE";
  readonly totalMinor: bigint;
  readonly shares: readonly {
    readonly memberId: string;
    readonly basisPoints: bigint;
  }[];
};
type WeightSplit = {
  readonly mode: "WEIGHT";
  readonly totalMinor: bigint;
  readonly shares: readonly {
    readonly memberId: string;
    readonly weightHundredths: bigint;
  }[];
};

export type SplitInput =
  EqualSplit | ExactSplit | PercentageSplit | WeightSplit;

function assertUniqueMemberIds(memberIds: readonly string[]): void {
  if (memberIds.length === 0) {
    throw new Error("至少需要一个分摊成员");
  }
  if (new Set(memberIds).size !== memberIds.length) {
    throw new Error("分摊成员不能重复");
  }
}

function compareMemberIds(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;

  return 0;
}

/**
 * Expense 只支持均摊、指定金额、比例和份数四种模式。
 * 所有模式都返回按 ActivityMember ID 排序的最小单位分摊事实，确保保存前即可验证守恒。
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
    if (
      input.shares.reduce((sum, share) => sum + share.amountMinor, 0n) !==
      input.totalMinor
    ) {
      throw new Error("指定金额合计必须等于消费总额");
    }

    return [...input.shares].sort((left, right) =>
      compareMemberIds(left.memberId, right.memberId),
    );
  }

  if (input.mode === "PERCENTAGE") {
    if (
      input.shares.reduce((sum, share) => sum + share.basisPoints, 0n) !==
      10_000n
    ) {
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
