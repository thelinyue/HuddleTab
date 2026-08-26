import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** 结算页上下文只读取账务身份和权威 Ledger 快照，不接受任何客户端余额。 */
export async function GET(
  request: Request,
  context: { params: Promise<{ activityId: string }> },
) {
  const [
    { requireSession, sessionUserId },
    { sql },
    { SettlementService },
    { applicationErrorResponse },
  ] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/db/client"),
    import("@/server/services/settlement-service"),
    import("@/server/http/application-error-response"),
  ]);
  try {
    const [params, session] = await Promise.all([
      context.params,
      requireSession(request.headers),
    ]);
    const data = await new SettlementService(sql).getPageContext(
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
