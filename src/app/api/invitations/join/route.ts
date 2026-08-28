import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const joinInput = z.object({
  inviteProof: z
    .string()
    .min(20)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/),
});

/** token-only 加入端点在认证后重新校验 Token；URL 回跳从不参与授权判断。 */
export async function POST(request: Request) {
  const [
    { requireSession, sessionUserId },
    { InvitationService },
    { sql },
    { MaintenanceMode },
    { RateLimiter },
    { authRuntimeConfig },
    { resolveClientIp },
    { applicationErrorResponse },
  ] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/services/invitation-service"),
    import("@/server/db/client"),
    import("@/server/maintenance/maintenance-mode"),
    import("@/server/security/rate-limiter"),
    import("@/server/auth/runtime-config"),
    import("@/server/security/client-ip"),
    import("@/server/http/application-error-response"),
  ]);
  try {
    const session = await requireSession(request.headers);
    const parsed = joinInput.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: { code: "INVALID_INVITATION", message: "邀请链接格式无效。" },
        },
        { status: 400 },
      );
    }
    await new MaintenanceMode(sql).assertWritesAllowed();
    const userId = sessionUserId(session);
    const clientIp = resolveClientIp({
      trustedProxy: process.env.TRUST_PROXY === "true",
      connectionIp: "direct-connection",
      headers: request.headers,
    });
    await new RateLimiter(sql, authRuntimeConfig.secret).consume(
      "INVITATION",
      `${clientIp}:${userId}:${parsed.data.inviteProof}`,
      { limit: 10, windowSeconds: 600 },
    );
    const data = await new InvitationService(sql).join({
      session: { user: { id: userId } },
      inviteProof: parsed.data.inviteProof,
    });
    return NextResponse.json(
      { data },
      { status: data.status === "JOINED" ? 201 : 200 },
    );
  } catch (error) {
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
