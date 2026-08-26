import { z } from "zod";

export const dynamic = "force-dynamic";
const sessionQuery = z.object({ sessionId: z.string().min(1) });

export async function GET(request: Request) {
  const [{ requireSession }, { auth }, { redactSessions }] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/auth/auth"),
    import("@/server/services/me-service"),
  ]);
  await requireSession(request.headers);
  const sessions = await auth.api.listSessions({ headers: request.headers });
  return Response.json({ data: redactSessions(sessions) });
}

export async function DELETE(request: Request) {
  const [{ requireSession, sessionId }, { auth }, { ApplicationError }] =
    await Promise.all([
      import("@/server/auth/session"),
      import("@/server/auth/auth"),
      import("@/server/errors/application-error"),
    ]);
  const current = await requireSession(request.headers);
  const targetId = sessionQuery.parse({
    sessionId: new URL(request.url).searchParams.get("sessionId"),
  }).sessionId;
  const sessions = await auth.api.listSessions({ headers: request.headers });
  const target = sessions.find((session) => session.id === targetId);

  if (!target) {
    throw new ApplicationError(
      "SESSION_NOT_FOUND",
      "指定登录设备不存在。",
      404,
    );
  }
  if (target.id === sessionId(current)) {
    throw new ApplicationError(
      "CURRENT_SESSION_REVOKE_FORBIDDEN",
      "不能撤销当前登录设备。",
      422,
    );
  }

  await auth.api.revokeSession({
    headers: request.headers,
    body: { token: target.token },
  });
  return new Response(null, { status: 204 });
}
