import { isAPIError } from "@better-auth/core/utils/is-api-error";
import { z } from "zod";

import { auth } from "@/server/auth/auth";
import { requireSession } from "@/server/auth/session";
import { ApplicationError } from "@/server/errors/application-error";

const passwordInput = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});

function errorResponse(error: ApplicationError): Response {
  return Response.json(
    {
      error: {
        code: error.code,
        message: error.message,
        fieldErrors: {},
        details: error.details,
      },
    },
    { status: error.status },
  );
}

/**
 * 密码修改仅验证 HTTP 输入后委托 Better Auth changePassword；路由既不读取 credential
 * hash，也不把当前密码或新密码写入日志、响应或数据库。
 */
export async function POST(request: Request): Promise<Response> {
  try {
    await requireSession(request.headers);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(
        new ApplicationError(
          "INVALID_PASSWORD_INPUT",
          "密码格式不正确：新密码需要 8 到 128 个字符，且必须填写当前密码。",
          422,
        ),
      );
    }

    const parsed = passwordInput.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        new ApplicationError(
          "INVALID_PASSWORD_INPUT",
          "密码格式不正确：新密码需要 8 到 128 个字符，且必须填写当前密码。",
          422,
        ),
      );
    }

    await auth.api.changePassword({
      headers: request.headers,
      body: parsed.data,
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof ApplicationError) return errorResponse(error);
    if (isAPIError(error) && error.body?.code === "INVALID_PASSWORD") {
      return errorResponse(
        new ApplicationError(
          "INVALID_CURRENT_PASSWORD",
          "当前密码不正确。",
          400,
        ),
      );
    }
    throw error;
  }
}
