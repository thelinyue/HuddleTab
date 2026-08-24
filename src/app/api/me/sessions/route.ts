import { auth } from "@/server/auth/auth";
import { requireSession } from "@/server/auth/session";
import { ApplicationError } from "@/server/errors/application-error";

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
 * session 的创建、有效期和令牌继续由 Better Auth 管理；本路由只投影可安全展示的元数据，
 * 因而不会把 token 或认证邮箱暴露给前端。
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const current = await requireSession(request.headers);
    const sessions = await auth.api.listSessions({ headers: request.headers });
    const data = sessions.map((session) => ({
      id: session.id,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      current: session.id === current.session.id,
    }));
    return Response.json({ data });
  } catch (error) {
    if (error instanceof ApplicationError) return errorResponse(error);
    throw error;
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    await requireSession(request.headers);
    const sessionId = new URL(request.url).searchParams.get("sessionId");
    if (!sessionId) {
      return errorResponse(
        new ApplicationError(
          "INVALID_SESSION_ID",
          "请选择需要退出的会话。",
          422,
        ),
      );
    }

    const sessions = await auth.api.listSessions({ headers: request.headers });
    const target = sessions.find((session) => session.id === sessionId);
    if (!target) {
      return errorResponse(
        new ApplicationError(
          "SESSION_NOT_FOUND",
          "要退出的会话不存在或不属于当前用户。",
          404,
        ),
      );
    }

    await auth.api.revokeSession({
      headers: request.headers,
      body: { token: target.token },
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof ApplicationError) return errorResponse(error);
    throw error;
  }
}
