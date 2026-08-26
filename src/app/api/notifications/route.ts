import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** 通知只读取当前账号的服务器记录；未实现更多通知类型时自然返回空列表。 */
export async function GET(request: Request) {
  const [
    { requireSession, sessionUserId },
    { sql },
    { applicationErrorResponse },
  ] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/db/client"),
    import("@/server/http/application-error-response"),
  ]);
  try {
    const userId = sessionUserId(await requireSession(request.headers));
    const rows =
      await sql`select id, type, target_type, target_id, read_at, created_at from notifications where recipient_user_id = ${userId} order by created_at desc limit 100`;
    return NextResponse.json({
      data: rows.map((row) => ({
        id: row.id,
        type: row.type,
        targetType: row.target_type,
        targetId: row.target_id,
        readAt: row.read_at instanceof Date ? row.read_at.toISOString() : null,
        createdAt:
          row.created_at instanceof Date
            ? row.created_at.toISOString()
            : String(row.created_at),
      })),
    });
  } catch (error) {
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
