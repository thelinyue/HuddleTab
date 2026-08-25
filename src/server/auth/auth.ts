import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins";
import { getDatabaseClient } from "@/server/db";
import * as schema from "@/server/db/schema";

import { normalizeUsername } from "./username";

/**
 * Better Auth 初始化会在模块加载后异步创建适配器；此代理仅在适配器实际执行查询时
 * 才读取 DATABASE_URL 并获取 Drizzle 客户端，保持构建期与既有数据库惰性边界一致。
 */
const lazyDatabase = new Proxy(
  {} as ReturnType<typeof getDatabaseClient>["db"],
  {
    get(_target, property) {
      const database = getDatabaseClient().db;
      const value = Reflect.get(database, property);

      return typeof value === "function" ? value.bind(database) : value;
    },
  },
);

function readAuthBaseUrl(): string {
  const baseUrl = process.env.BETTER_AUTH_URL?.trim();

  if (!baseUrl) {
    throw new Error("认证服务缺少 BETTER_AUTH_URL 配置。");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new Error(
      "认证服务配置无效：BETTER_AUTH_URL 必须是有效的 HTTP 或 HTTPS 地址。",
    );
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(
      "认证服务配置无效：BETTER_AUTH_URL 仅支持 HTTP 或 HTTPS 地址。",
    );
  }

  return baseUrl;
}

/**
 * 显式配置的密钥按原始字符串传给 Better Auth，避免 trim 改变部署者约定的密钥字节；
 * 只用 trim 判断空白值，并在进入 Better Auth 前拒绝不足 32 字符的弱密钥。
 */
export function readAuthSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;

  if (!secret?.trim()) {
    throw new Error("认证服务缺少 BETTER_AUTH_SECRET 配置。");
  }

  if (secret.length < 32) {
    throw new Error(
      "认证服务配置无效：BETTER_AUTH_SECRET 至少需要 32 个字符。",
    );
  }

  return secret;
}

/**
 * SECURE_COOKIES 是唯一的部署者覆盖值。未设置时按照公开认证地址推导，保证 HTTP
 * 默认可用且 HTTPS 不会遗漏 Secure；任何非精确 true/false 值都属于部署配置错误。
 */
function readUseSecureCookies(baseUrl: string): boolean {
  const override = process.env.SECURE_COOKIES;

  if (override === undefined || override === "") {
    return new URL(baseUrl).protocol === "https:";
  }

  if (override === "true") return true;
  if (override === "false") return false;

  throw new Error("认证服务配置无效：SECURE_COOKIES 仅支持 true 或 false。");
}

/**
 * 认证实例延迟到首次实际使用时才创建：构建只需静态导入路由，而运行期仍强制要求
 * 部署入口提供真实密钥和公开地址，绝不生成、写死或记录临时认证密钥。
 */
function createAuth() {
  const baseUrl = readAuthBaseUrl();

  return betterAuth({
    database: drizzleAdapter(lazyDatabase, { provider: "pg", schema }),
    baseURL: baseUrl,
    secret: readAuthSecret(),
    advanced: { useSecureCookies: readUseSecureCookies(baseUrl) },
    emailAndPassword: { enabled: true, requireEmailVerification: false },
    plugins: [
      username({
        minUsernameLength: 3,
        maxUsernameLength: 32,
        usernameNormalization: normalizeUsername,
        validationOrder: { username: "post-normalization" },
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
}

type AuthInstance = ReturnType<typeof createAuth>;

let initializedAuth: AuthInstance | undefined;

function getAuth(): AuthInstance {
  initializedAuth ??= createAuth();
  return initializedAuth;
}

/**
 * 保留 Better Auth 的标准 auth 对象接口，同时避开 Next.js build 只导入模块时的环境读取。
 * 任意认证 API 或路由处理器真正访问该对象时都会通过 getAuth() 进入运行期配置校验。
 */
export const auth = new Proxy({} as AuthInstance, {
  get(_target, property) {
    const instance = getAuth();
    const value = Reflect.get(instance, property);

    return typeof value === "function" ? value.bind(instance) : value;
  },
  has(_target, property) {
    return property in getAuth();
  },
});
