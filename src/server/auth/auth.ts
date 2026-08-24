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

function readRequiredAuthEnvironment(
  name: "BETTER_AUTH_SECRET" | "BETTER_AUTH_URL",
) {
  const value = process.env[name];

  if (!value?.trim()) {
    throw new Error(`认证服务缺少 ${name} 配置。`);
  }

  return value;
}

/**
 * 认证实例延迟到首次实际使用时才创建：构建只需静态导入路由，而运行期仍强制要求
 * 部署入口提供真实密钥和公开地址，绝不生成、写死或记录临时认证密钥。
 */
function createAuth() {
  return betterAuth({
    database: drizzleAdapter(lazyDatabase, { provider: "pg", schema }),
    baseURL: readRequiredAuthEnvironment("BETTER_AUTH_URL"),
    secret: readRequiredAuthEnvironment("BETTER_AUTH_SECRET"),
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
