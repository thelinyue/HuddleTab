import "server-only";

import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";

import * as schema from "@/server/db/schema";
import { db, sql } from "@/server/db/client";
import { ApplicationError } from "@/server/errors/application-error";
import { resolveClientIp } from "@/server/security/client-ip";
import { RateLimiter } from "@/server/security/rate-limiter";

import { authRuntimeConfig } from "./runtime-config";
import { normalizeUsername } from "./username";

const rateLimiter = new RateLimiter(sql, authRuntimeConfig.secret);

/** Better Auth 按模型名查找表；项目 schema 使用复数导出名，需在适配层明确转换。 */
const betterAuthSchema = {
  user: schema.users,
  session: schema.sessions,
  account: schema.accounts,
  verification: schema.verifications,
};

/**
 * Better Auth 的登录端点在密码校验之前执行本 Hook。Route Handler 无法取得
 * 直连 TCP 对端地址，因此未启用可信代理时使用固定直连边界；用户名或邮箱
 * 始终作为第二个稳定维度，避免仅靠地址决定限流结果。
 */
const loginRateLimitHook = createAuthMiddleware(async (context) => {
  if (
    context.path !== "/sign-in/username" &&
    context.path !== "/sign-in/email"
  ) {
    return;
  }

  const identity =
    context.path === "/sign-in/username"
      ? context.body.username
      : context.body.email;
  if (typeof identity !== "string") return;

  try {
    const clientIp = resolveClientIp({
      trustedProxy: process.env.TRUST_PROXY === "true",
      connectionIp: "direct-connection",
      headers: context.request?.headers ?? new Headers(),
    });
    await rateLimiter.consume(
      "LOGIN",
      `${clientIp}:${identity.trim().toLowerCase()}`,
      { limit: 10, windowSeconds: 600 },
    );
  } catch (error) {
    if (error instanceof ApplicationError) {
      throw APIError.fromStatus(
        error.status === 429 ? "TOO_MANY_REQUESTS" : "BAD_REQUEST",
        {
          code: error.code,
          message: error.message,
        },
      );
    }
    throw error;
  }
});

/**
 * Better Auth 是凭证、密码和 HttpOnly Session Cookie 的唯一权威。
 * 产品注册服务先写入规范化用户名；此处再次校验，防止配置入口产生不同的唯一键。
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema: betterAuthSchema }),
  baseURL: authRuntimeConfig.baseURL,
  secret: authRuntimeConfig.secret,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  advanced: {
    // 反向代理信任由 HuddleTab 的显式部署配置控制，认证框架不自动采信转发 Host/Proto。
    trustedProxyHeaders: false,
  },
  // Better Auth 默认仅按 IP 进行登录限流；项目的持久限流同时包含 IP 与用户名，
  // 才能满足部署边界并避免同一 NAT 下的正常用户互相阻塞。
  rateLimit: { enabled: false },
  hooks: { before: loginRateLimitHook },
  plugins: [
    username({
      minUsernameLength: 3,
      maxUsernameLength: 32,
      usernameValidator: (value) => {
        try {
          return normalizeUsername(value) === value;
        } catch {
          return false;
        }
      },
    }),
  ],
});
