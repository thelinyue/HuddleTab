import { ApplicationError } from "@/server/errors/application-error";

export interface SessionReader {
  getSession(input: { headers: Headers }): Promise<unknown>;
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
