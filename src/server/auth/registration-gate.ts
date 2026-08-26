import { ApplicationError } from "@/server/errors/application-error";

export type RegistrationPolicy = "INVITE_ONLY" | "OPEN";

export interface InvitationRegistrationVerifier {
  verify(proof: string): Promise<boolean>;
}

/**
 * 注册策略的唯一准入判断。Phase 3 会注入活动邀请验证器；在此之前，
 * INVITE_ONLY 不允许缺少或无法验证邀请凭证的普通注册。
 */
export async function assertRegistrationAllowed(
  policy: RegistrationPolicy,
  proof: string | undefined,
  verifier: InvitationRegistrationVerifier,
): Promise<void> {
  if (policy === "OPEN") return;

  if (!proof || !(await verifier.verify(proof))) {
    throw new ApplicationError(
      "REGISTRATION_INVITE_REQUIRED",
      "当前系统仅允许受邀用户注册。",
      403,
    );
  }
}
