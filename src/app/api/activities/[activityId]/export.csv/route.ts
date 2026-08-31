import { serializeExpenseCsv } from "@/server/export/expense-csv";
import { DEFAULT_TIME_ZONE } from "@/lib/time-zone";

export const dynamic = "force-dynamic";

/** CSV 使用固定安全文件名，避免将用户输入的活动名称直接放入响应 Header。 */
export async function GET(
  request: Request,
  context: { params: Promise<{ activityId: string }> },
) {
  const [
    { requireSession, sessionUserId },
    { sql },
    { ActivitySummaryService },
    { applicationErrorResponse },
  ] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/db/client"),
    import("@/server/services/activity-summary-service"),
    import("@/server/http/application-error-response"),
  ]);
  try {
    const [params, session] = await Promise.all([
      context.params,
      requireSession(request.headers),
    ]);
    const rows = await new ActivitySummaryService(sql).getExpenseExport(
      { user: { id: sessionUserId(session) } },
      params.activityId,
    );
    return new Response(
      serializeExpenseCsv(rows, process.env.TZ ?? DEFAULT_TIME_ZONE),
      {
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Disposition": 'attachment; filename="activity-export.csv"',
          "Content-Type": "text/csv; charset=utf-8",
        },
      },
    );
  } catch (error) {
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
