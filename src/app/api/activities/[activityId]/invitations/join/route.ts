import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const joinInput = z.object({
  inviteProof: z.string().min(20),
  displayName: z.string().trim().min(1).max(40),
});

/** 加入前先消耗邀请限流桶，原始 proof 只传给验证服务且不会写入日志。 */
export async function POST(
  request: Request,
  context: { params: Promise<{ activityId: string }> },
) {
  const [
    { requireSession, sessionUserId },
    { InvitationService },
    { sql },
    { RateLimiter },
    { authRuntimeConfig },
    { resolveClientIp },
    { applicationErrorResponse },
  ] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/services/invitation-service"),
    import("@/server/db/client"),
    import("@/server/security/rate-limiter"),
    import("@/server/auth/runtime-config"),
    import("@/server/security/client-ip"),
    import("@/server/http/application-error-response"),
  ]);
  try {
    const [params, body, session] = await Promise.all([
      context.params,
      joinInput.parseAsync(await request.json()),
      requireSession(request.headers),
    ]);
    const userId = sessionUserId(session);
    const clientIp = resolveClientIp({
      trustedProxy: process.env.TRUST_PROXY === "true",
      connectionIp: "direct-connection",
      headers: request.headers,
    });
    await new RateLimiter(sql, authRuntimeConfig.secret).consume(
      "INVITATION",
      `${clientIp}:${userId}:${body.inviteProof}`,
      { limit: 10, windowSeconds: 600 },
    );
    const data = await new InvitationService(sql).join({
      session: { user: { id: userId } },
      activityId: params.activityId,
      inviteProof: body.inviteProof,
      displayName: body.displayName,
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
