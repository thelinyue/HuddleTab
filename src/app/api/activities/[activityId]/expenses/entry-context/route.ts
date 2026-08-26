import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** 快速记账的最小读模型，不复用费用列表以避免混入不必要的账务事实。 */
export async function GET(
  request: Request,
  context: { params: Promise<{ activityId: string }> },
) {
  const [
    { requireSession, sessionUserId },
    { sql },
    { ExpenseService },
    { applicationErrorResponse },
  ] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/db/client"),
    import("@/server/services/expense-service"),
    import("@/server/http/application-error-response"),
  ]);
  try {
    const [params, session] = await Promise.all([
      context.params,
      requireSession(request.headers),
    ]);
    const data = await new ExpenseService(sql).getEntryContext(
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
