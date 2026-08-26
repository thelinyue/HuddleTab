export interface AllocationWeight {
  readonly memberId: string;
  readonly weight: bigint;
}

export interface AllocationResult {
  readonly memberId: string;
  readonly amountMinor: bigint;
}

function compareMemberIds(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;

  return 0;
}

/**
 * 先向下取整，再按 ActivityMember ID 的稳定升序补发最小单位。
 * 输入顺序、显示昵称、界面排序及 Guest 后续绑定账号均不能影响已确定的尾差归属。
 */
export function allocateByWeights(
  totalMinor: bigint,
  inputs: readonly AllocationWeight[],
): AllocationResult[] {
  if (totalMinor < 0n) {
    throw new Error("分配总额不能为负数");
  }
  if (inputs.length === 0) {
    throw new Error("至少需要一个分配成员");
  }

  const sorted = [...inputs].sort((left, right) =>
    compareMemberIds(left.memberId, right.memberId),
  );

  if (new Set(sorted.map((row) => row.memberId)).size !== sorted.length) {
    throw new Error("分配成员不能重复");
  }
  if (sorted.some((row) => row.weight <= 0n)) {
    throw new Error("分配权重必须大于零");
  }

  const totalWeight = sorted.reduce((sum, row) => sum + row.weight, 0n);
  const result = sorted.map((row) => ({
    memberId: row.memberId,
    amountMinor: (totalMinor * row.weight) / totalWeight,
  }));
  let remainder =
    totalMinor - result.reduce((sum, row) => sum + row.amountMinor, 0n);

  for (const row of result) {
    if (remainder === 0n) break;

    row.amountMinor += 1n;
    remainder -= 1n;
  }

  return result;
}
