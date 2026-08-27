import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const defaultBaseURL = "http://localhost:5660";

interface AuthEnvironment {
  readonly APP_BASE_URL?: string;
  readonly BETTER_AUTH_SECRET?: string;
  readonly BETTER_AUTH_URL?: string;
}

export interface AuthRuntimeConfigInput {
  readonly dataDir: string;
  readonly env: AuthEnvironment;
}

export interface AuthRuntimeConfig {
  readonly baseURL: string;
  readonly secret: string;
  readonly trustedOrigins: readonly string[];
}

/**
 * 本机容器常由浏览器通过 localhost 或 127.0.0.1 访问。两者不共享 Cookie，
 * 但都指向同一回环服务；因此仅在部署地址本身为回环地址时补充另一种写法。
 * 其他部署地址保持精确匹配，不能借此扩大跨站认证请求的信任范围。
 */
function resolveTrustedOrigins(baseURL: string): readonly string[] {
  const url = new URL(baseURL);
  const origin = url.origin;
  if (url.hostname === "localhost") {
    const loopbackUrl = new URL(origin);
    loopbackUrl.hostname = "127.0.0.1";
    return [origin, loopbackUrl.origin];
  }
  if (url.hostname === "127.0.0.1") {
    const localhostUrl = new URL(origin);
    localhostUrl.hostname = "localhost";
    return [origin, localhostUrl.origin];
  }
  return [origin];
}

function readOrCreateSecret(dataDir: string): string {
  const secretPath = join(dataDir, "auth-secret");
  const readSecret = (): string => {
    const secret = readFileSync(secretPath, "utf8").trim();

    if (!secret) {
      throw new Error("认证密钥文件为空，请修复后重试。");
    }

    return secret;
  };

  try {
    return readSecret();
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }

  mkdirSync(dataDir, { recursive: true });
  const generated = randomBytes(32).toString("base64url");

  try {
    writeFileSync(secretPath, `${generated}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    return generated;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "EEXIST"
    ) {
      throw error;
    }

    return readSecret();
  }
}

/**
 * 部署者可显式提供 Secret；未提供时只在持久数据目录生成一次。
 * 明文绝不写入日志或 API，镜像升级后仍使用同一文件以维持已有 Session 的有效性。
 */
export function resolveAuthRuntimeConfig(
  input: AuthRuntimeConfigInput,
): AuthRuntimeConfig {
  const baseURL =
    input.env.BETTER_AUTH_URL ?? input.env.APP_BASE_URL ?? defaultBaseURL;
  return {
    baseURL,
    secret: input.env.BETTER_AUTH_SECRET ?? readOrCreateSecret(input.dataDir),
    trustedOrigins: resolveTrustedOrigins(baseURL),
  };
}

export const authRuntimeConfig = resolveAuthRuntimeConfig({
  dataDir: process.env.DATA_DIR ?? join(process.cwd(), "data"),
  env: {
    APP_BASE_URL: process.env.APP_BASE_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
  },
});
