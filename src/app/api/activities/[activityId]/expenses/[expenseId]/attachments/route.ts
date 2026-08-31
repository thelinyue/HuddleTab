import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const clientAttachmentIdSchema = z.string().uuid();
const MAX_ATTACHMENT_MULTIPART_BYTES = 10 * 1024 * 1024 + 64 * 1024;

class AttachmentMultipartTooLargeError extends Error {}

/** 在解析 FormData 前限制原始 multipart 字节，避免未认证或畸形请求无限制占用内存。 */
async function parseAttachmentFormData(request: Request): Promise<FormData> {
  const contentLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_ATTACHMENT_MULTIPART_BYTES
  )
    throw new AttachmentMultipartTooLargeError();
  if (!request.body) return request.formData();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_ATTACHMENT_MULTIPART_BYTES) {
      await reader.cancel();
      throw new AttachmentMultipartTooLargeError();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Response(body, {
    headers: { "Content-Type": request.headers.get("content-type") ?? "" },
  }).formData();
}

/** 上传仅接收单个图片和离线幂等键；存储路径始终由服务端生成。 */
export async function POST(
  request: Request,
  context: {
    params: Promise<{ activityId: string; expenseId: string }>;
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
    const formData = await parseAttachmentFormData(request);
    const file = formData.get("file");
    const clientAttachmentId = clientAttachmentIdSchema.parse(
      formData.get("clientAttachmentId"),
    );
    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "请选择需要上传的图片。",
            fieldErrors: { file: ["请选择需要上传的图片。"] },
            details: {},
          },
        },
        { status: 422 },
      );
    }
    const result = await new AttachmentService(sql).upload({
      session: { user: { id: sessionUserId(session) } },
      activityId: params.activityId,
      expenseId: params.expenseId,
      clientAttachmentId,
      declaredMime: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    return NextResponse.json(
      { data: result.attachment },
      { status: result.idempotentReplay ? 200 : 201 },
    );
  } catch (error) {
    if (error instanceof AttachmentMultipartTooLargeError) {
      return NextResponse.json(
        {
          error: {
            code: "ATTACHMENT_TOO_LARGE",
            message: "图片不能超过 10MB。",
            fieldErrors: { file: ["图片不能超过 10MB。"] },
            details: {},
          },
        },
        { status: 422 },
      );
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "附件请求不合法，请检查后重试。",
            fieldErrors: error.flatten().fieldErrors,
            details: {},
          },
        },
        { status: 422 },
      );
    }
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
