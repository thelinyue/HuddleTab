import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** 推荐是当前 Ledger 的只读视图；用户确认后仍须单独创建 Settlement 事实。 */
export async function GET(
  request: Request,
  context: { params: Promise<{ activityId: string }> },
) {
  const [
    { requireSession, sessionUserId },
    { sql },
    { LedgerService },
    { applicationErrorResponse },
  ] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/db/client"),
    import("@/server/services/ledger-service"),
    import("@/server/http/application-error-response"),
  ]);
  try {
    const [params, session] = await Promise.all([
      context.params,
      requireSession(request.headers),
    ]);
    const data = await new LedgerService(sql).getRecommendations(
      { user: { id: sessionUserId(session) } },
      params.activityId,
    );
    return NextResponse.json({ data });
  } catch (error) {
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
