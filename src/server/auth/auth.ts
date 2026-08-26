import "server-only";

import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";

import * as schema from "@/server/db/schema";
import { db } from "@/server/db/client";

import { authRuntimeConfig } from "./runtime-config";
import { normalizeUsername } from "./username";

/**
 * Better Auth 是凭证、密码和 HttpOnly Session Cookie 的唯一权威。
 * 产品注册服务先写入规范化用户名；此处再次校验，防止配置入口产生不同的唯一键。
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
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
