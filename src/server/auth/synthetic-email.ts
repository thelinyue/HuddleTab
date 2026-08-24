export type EmailKind = "SYNTHETIC" | "REAL";

const syntheticEmailPattern = /^u_[0-9a-f]{32}@local\.invalid$/;

/**
 * 内部邮箱只为满足 Better Auth 的 email/password 存储兼容而存在：
 * 它不可投递、不可在界面展示，也不可作为邮件发送目标。
 */
export function createSyntheticEmail(identifier: unknown): string {
  const compact =
    typeof identifier === "string"
      ? identifier.replaceAll("-", "").toLowerCase()
      : "";

  if (!/^[0-9a-f]{32}$/.test(compact)) {
    throw new Error("生成内部邮箱时收到无效标识");
  }

  return `u_${compact}@local.invalid`;
}

/** 只识别完整、固定小写的内部地址，普通邮箱与近似值一律不误判。 */
export function isSyntheticEmail(email: unknown): boolean {
  return typeof email === "string" && syntheticEmailPattern.test(email);
}
