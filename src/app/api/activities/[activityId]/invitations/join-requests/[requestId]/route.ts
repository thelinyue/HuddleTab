import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const decisionInput = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  displayName: z.string().trim().min(1).max(40),
});

/** 审批 Route 只组装 Session 和输入；活动权限与所有数据库写入均由服务事务负责。 */
export async function POST(
  request: Request,
  context: { params: Promise<{ activityId: string; requestId: string }> },
) {
  const [
    { requireSession, sessionUserId },
    { InvitationService },
    { sql },
    { applicationErrorResponse },
  ] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/services/invitation-service"),
    import("@/server/db/client"),
    import("@/server/http/application-error-response"),
  ]);
  try {
    const [params, body, session] = await Promise.all([
      context.params,
      decisionInput.parseAsync(await request.json()),
      requireSession(request.headers),
    ]);
    await new InvitationService(sql).decideJoinRequest({
      session: { user: { id: sessionUserId(session) } },
      activityId: params.activityId,
      requestId: params.requestId,
      decision: body.decision,
      displayName: body.displayName,
    });
    return NextResponse.json({ data: { activityId: params.activityId } });
  } catch (error) {
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
