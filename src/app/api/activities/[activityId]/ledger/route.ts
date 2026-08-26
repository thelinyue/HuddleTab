import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Ledger 仅返回本次服务器快照中的权威余额，不接受客户端余额输入。 */
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
    const data = await new LedgerService(sql).getBalances(
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
