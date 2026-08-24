import { auth } from "./auth";
import { ApplicationError } from "@/server/errors/application-error";

type BetterAuthSessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

/**
 * 仅抽取 Better Auth 的真实 getSession 签名，方便单元测试注入读取器，同时不丢失
 * 框架返回的 session/user 具体类型与全部字段。
 */
export interface SessionReader {
  getSession(input: { headers: Headers }): Promise<BetterAuthSessionResult>;
}

/**
 * 所有需要登录身份的服务端入口共用此边界：没有有效 Better Auth session 时统一返回
 * 可预期的中文 401 业务错误；成功时原样返回认证框架的完整结果，不重新组装或裁剪字段。
 */
export async function requireSession(
  headers: Headers,
  reader: SessionReader = auth.api,
): Promise<NonNullable<BetterAuthSessionResult>> {
  const session = await reader.getSession({ headers });

  if (!session) {
    throw new ApplicationError(
      "UNAUTHENTICATED",
      "登录状态已失效，请重新登录。",
      401,
    );
  }

  return session;
}
