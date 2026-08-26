export type EmailKind = "SYNTHETIC" | "REAL";

const syntheticEmailPattern = /^u_[0-9a-f]{32}@local\.invalid$/;

/** 该地址仅满足认证存储兼容，不可投递、不可展示、不可触发邮件。 */
export function createSyntheticEmail(id: string): string {
  const compactId = id.replaceAll("-", "").toLowerCase();

  if (!/^[0-9a-f]{32}$/.test(compactId)) {
    throw new Error("生成内部邮箱时收到无效标识");
  }

  return `u_${compactId}@local.invalid`;
}

export function isSyntheticEmail(email: string): boolean {
  return syntheticEmailPattern.test(email);
}
