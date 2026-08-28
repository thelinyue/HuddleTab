import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * 邀请明文只在重置时返回一次；数据库继续只保存 Hash。关闭和重置均由
 * InvitationService 在权限事务内完成，Route 不复制成员管理权限判断。
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ activityId: string }> },
) {
  return updateInvitation(request, context, "reset");
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ activityId: string }> },
) {
  return updateInvitation(request, context, "disable");
}

async function updateInvitation(
  request: Request,
  context: { params: Promise<{ activityId: string }> },
  operation: "reset" | "disable",
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
    const service = new InvitationService(sql);
    const input = {
      session: { user: { id: sessionUserId(session) } },
      activityId: params.activityId,
    };
    if (operation === "disable") {
      await service.disableLink(input);
      return NextResponse.json({ data: { disabled: true } });
    }
    const raw = await service.resetLink(input);
    return NextResponse.json(
      { data: { invitePath: `/join/${encodeURIComponent(raw)}` } },
      { status: 201 },
    );
  } catch (error) {
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
