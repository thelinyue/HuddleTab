import { ApplicationError } from "@/server/errors/application-error";

export interface SessionReader {
  getSession(input: { headers: Headers }): Promise<unknown>;
}

/** Better Auth Session 的最小产品所需视图，避免 Route Handler 依赖完整内部类型。 */
export function sessionUserId(session: unknown): string {
  if (
    typeof session !== "object" ||
    session === null ||
    !("user" in session) ||
    typeof session.user !== "object" ||
    session.user === null ||
    !("id" in session.user) ||
    typeof session.user.id !== "string"
  ) {
    throw new ApplicationError(
      "UNAUTHENTICATED",
      "登录状态已失效，请重新登录。",
      401,
    );
  }

  return session.user.id;
}

export function sessionId(session: unknown): string {
  if (
    typeof session !== "object" ||
    session === null ||
    !("session" in session) ||
    typeof session.session !== "object" ||
    session.session === null ||
    !("id" in session.session) ||
    typeof session.session.id !== "string"
  ) {
    throw new ApplicationError(
      "UNAUTHENTICATED",
      "登录状态已失效，请重新登录。",
      401,
    );
  }

  return session.session.id;
}

/** 每个受保护 Route Handler 都通过此入口取得 Better Auth 服务端 Session。 */
export async function requireSession(
  headers: Headers,
  reader?: SessionReader,
): Promise<NonNullable<Awaited<ReturnType<SessionReader["getSession"]>>>> {
  const sessionReader = reader ?? (await import("./auth")).auth.api;
  const session = await sessionReader.getSession({ headers });

  if (!session) {
    throw new ApplicationError(
      "UNAUTHENTICATED",
      "登录状态已失效，请重新登录。",
      401,
    );
  }

  return session as NonNullable<typeof session>;
}
