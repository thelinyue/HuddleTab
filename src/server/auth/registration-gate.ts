import { ApplicationError } from "@/server/errors/application-error";

export type RegistrationPolicy = "INVITE_ONLY" | "OPEN";

/** Phase 3 会提供活动邀请的实际校验；Phase 2 只依赖这个最小门禁接口。 */
export interface InvitationRegistrationVerifier {
  verify(inviteProof: string): Promise<boolean>;
}

/**
 * 在创建任何认证记录之前决定是否允许注册，确保 INVITE_ONLY 策略不会被业务服务绕过。
 */
export async function assertRegistrationAllowed(
  policy: RegistrationPolicy,
  inviteProof: string | undefined,
  verifier: InvitationRegistrationVerifier,
): Promise<void> {
  if (policy === "OPEN") {
    return;
  }

  if (!inviteProof || !(await verifier.verify(inviteProof))) {
    throw new ApplicationError(
      "REGISTRATION_INVITE_REQUIRED",
      "当前系统仅允许受邀用户注册。",
      403,
    );
  }
}
