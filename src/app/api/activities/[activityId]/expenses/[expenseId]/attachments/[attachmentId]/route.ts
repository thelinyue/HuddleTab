import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** 下载重新执行历史读取授权；内部 storageKey 不进入 URL、Header 或响应体。 */
export async function GET(
  request: Request,
  context: {
    params: Promise<{
      activityId: string;
      expenseId: string;
      attachmentId: string;
    }>;
  },
) {
  const [
    { requireSession, sessionUserId },
    { sql },
    { AttachmentService },
    { applicationErrorResponse },
  ] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/db/client"),
    import("@/server/services/attachment-service"),
    import("@/server/http/application-error-response"),
  ]);
  try {
    const [params, session] = await Promise.all([
      context.params,
      requireSession(request.headers),
    ]);
    const attachment = await new AttachmentService(sql).download(
      { user: { id: sessionUserId(session) } },
      params.activityId,
      params.expenseId,
      params.attachmentId,
    );
    return new NextResponse(new Uint8Array(attachment.bytes), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": attachment.mimeType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
