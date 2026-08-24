export interface AllocationWeight {
  readonly memberId: string;
  readonly weight: bigint;
}

export interface AllocationResult {
  readonly memberId: string;
  readonly amountMinor: bigint;
}

/**
 * 以 Unicode 代码点逐一比较成员 ID，避免默认 localeCompare 受运行环境 locale
 * 配置影响。ActivityMember ID 是稳定账务身份；输入顺序、昵称、UI 排序以及 Guest
 * 后续绑定账号都不能改变分配结果。
 */
export function compareMemberIds(left: string, right: string): number {
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

/**
 * 先按稳定的 ActivityMember ID 向下取整，再按同一顺序补齐剩余最小单位。
 * 该函数只复制并排序内部数组，不会改变调用方传入的成员行或其展示顺序。
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

  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1].memberId === sorted[index].memberId) {
      throw new Error("分配成员不能重复");
    }
  }
  if (sorted.some((row) => row.weight <= 0n)) {
    throw new Error("分配权重必须大于零");
  }

  const weightSum = sorted.reduce((sum, row) => sum + row.weight, 0n);
  const result = sorted.map((row) => ({
    memberId: row.memberId,
    amountMinor: (totalMinor * row.weight) / weightSum,
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
