import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const decisionInput = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
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
    { MaintenanceMode },
    { applicationErrorResponse },
  ] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/services/invitation-service"),
    import("@/server/db/client"),
    import("@/server/maintenance/maintenance-mode"),
    import("@/server/http/application-error-response"),
  ]);
  try {
    const [params, session] = await Promise.all([
      context.params,
      requireSession(request.headers),
    ]);
    await new MaintenanceMode(sql).assertWritesAllowed();
    const body = await decisionInput.parseAsync(await request.json());
    await new InvitationService(sql).decideJoinRequest({
      session: { user: { id: sessionUserId(session) } },
      activityId: params.activityId,
      requestId: params.requestId,
      decision: body.decision,
    });
    return NextResponse.json({ data: { activityId: params.activityId } });
  } catch (error) {
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
