import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** 已读更新按当前 Session 用户收窄，避免枚举或修改其他人的通知。 */
export async function POST(
  request: Request,
  context: { params: Promise<{ notificationId: string }> },
) {
  const [
    { requireSession, sessionUserId },
    { sql },
    { NotificationService },
    { applicationErrorResponse },
  ] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/db/client"),
    import("@/server/services/notification-service"),
    import("@/server/http/application-error-response"),
  ]);
  try {
    const [session, params] = await Promise.all([
      requireSession(request.headers),
      context.params,
    ]);
    await new NotificationService(sql).markRead(
      sessionUserId(session),
      params.notificationId,
    );
    return NextResponse.json({ data: { read: true } });
  } catch (error) {
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
