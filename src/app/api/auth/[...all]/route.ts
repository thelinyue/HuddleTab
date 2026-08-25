import { toNextJsHandler } from "better-auth/next-js";
import { auth, readAuthSecret } from "@/server/auth/auth";
import { normalizeUsername } from "@/server/auth/username";
import { getDatabaseClient } from "@/server/db";
import { ApplicationError } from "@/server/errors/application-error";
import { getClientAddress } from "@/server/security/client-address";
import {
  RateLimiter,
  type RateLimitBucket,
} from "@/server/security/rate-limiter";

const handlers = toNextJsHandler(auth);

/** 认证路由的资源语义不受任意数量的尾斜杠影响，避免策略路径被表示形式绕过。 */
function normalizeAuthPathname(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

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
 * Better Auth 1.7.1 的 hooks.before 异常发生在端点 APIError 转换之外。登录限流因此
 * 必须在 Next 路由转发前执行，才能把 ApplicationError 稳定转换为 V1 错误信封而非 500。
 */
async function consumeLoginRateLimit(request: Request): Promise<void> {
  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    return;
  }

  if (!body || typeof body !== "object" || !("username" in body)) return;

  let username: string;
  try {
    username = normalizeUsername(body.username);
  } catch {
    // 无法形成规范化用户名时交给 Better Auth 返回原有输入校验错误，不创建虚假 bucket。
    return;
  }

  const buckets: RateLimitBucket[] = [
    { scope: "LOGIN_USERNAME", identifier: username },
  ];
  const clientAddress = getClientAddress(request);
  if (clientAddress) {
    buckets.push({ scope: "LOGIN_IP", identifier: clientAddress });
  }

  await new RateLimiter(getDatabaseClient().sql, readAuthSecret()).consumeAll(
    buckets,
  );
}

/**
 * 浏览器不得直接访问 Better Auth 的 email 注册入口，否则会绕过 HuddleTab 的注册策略。
 * 此判断位于转发到 auth.handler 之前，因此被拒绝的请求不会读取认证或数据库运行时配置；
 * RegistrationService 仍可在进程内调用 auth.api.signUpEmail() 创建已通过门禁的账号。
 */
export async function POST(request: Request): Promise<Response> {
  const pathname = normalizeAuthPathname(new URL(request.url).pathname);
  if (pathname === "/api/auth/sign-up/email") {
    return Response.json(
      {
        error: {
          code: "AUTH_REGISTRATION_PATH_DISABLED",
          message: "请使用 /api/auth/register 完成注册。",
          fieldErrors: {},
          details: {},
        },
      },
      { status: 404 },
    );
  }

  try {
    if (pathname === "/api/auth/sign-in/username") {
      await consumeLoginRateLimit(request);
    }
    return handlers.POST(request);
  } catch (error) {
    if (error instanceof ApplicationError) return errorResponse(error);
    throw error;
  }
}

/** 其他 Better Auth 路由继续由官方 Next.js 适配器处理。 */
export const GET = handlers.GET;
