import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** 注册统一经过活动邀请验证器；原始邀请 proof 不进入日志或数据库。 */
export async function POST(request: Request) {
  const [
    { auth },
    { RegistrationService },
    { db },
    { registerInput },
    { RateLimiter },
    { authRuntimeConfig },
    { resolveClientIp },
    { applicationErrorResponse },
    { InvitationService },
  ] = await Promise.all([
    import("@/server/auth/auth"),
    import("@/server/services/registration-service"),
    import("@/server/db/client"),
    import("@/server/validation/auth"),
    import("@/server/security/rate-limiter"),
    import("@/server/auth/runtime-config"),
    import("@/server/security/client-ip"),
    import("@/server/http/application-error-response"),
    import("@/server/services/invitation-service"),
  ]);
  const input = registerInput.parse(await request.json());
  try {
    const clientIp = resolveClientIp({
      trustedProxy: process.env.TRUST_PROXY === "true",
      connectionIp: "direct-connection",
      headers: request.headers,
    });
    await new RateLimiter(db.$client, authRuntimeConfig.secret).consume(
      "REGISTRATION",
      `${clientIp}:${input.username}:${input.inviteProof ?? ""}`,
      { limit: 10, windowSeconds: 600 },
    );
  } catch (error) {
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
  try {
    const data = await new RegistrationService(
      new InvitationService(db.$client),
      {
        database: db,
        credentials: auth.api,
      },
    ).register(input);
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
