import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveAuthRuntimeConfig } from "@/server/auth/runtime-config";

describe("认证运行时配置", () => {
  it("无环境变量时在数据目录生成并复用安全 Secret", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "huddletab-auth-config-"));

    try {
      const first = resolveAuthRuntimeConfig({ dataDir, env: {} });
      const second = resolveAuthRuntimeConfig({ dataDir, env: {} });

      expect(first.baseURL).toBe("http://localhost:5660");
      expect(first.trustedOrigins).toEqual([
        "http://localhost:5660",
        "http://127.0.0.1:5660",
      ]);
      expect(first.secret).toHaveLength(43);
      expect(second.secret).toBe(first.secret);
      expect(readFileSync(join(dataDir, "auth-secret"), "utf8").trim()).toBe(
        first.secret,
      );
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("优先使用部署者显式提供的 URL 与 Secret", () => {
    expect(
      resolveAuthRuntimeConfig({
        dataDir: "unused",
        env: {
          APP_BASE_URL: "https://tab.example.com",
          BETTER_AUTH_SECRET: "provided-secret",
        },
      }),
    ).toEqual({
      baseURL: "https://tab.example.com",
      secret: "provided-secret",
      trustedOrigins: ["https://tab.example.com"],
    });
  });

  it("本机回环部署同时信任同端口的 localhost 与 IP 地址", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "huddletab-auth-config-"));

    try {
      expect(
        resolveAuthRuntimeConfig({
          dataDir,
          env: { BETTER_AUTH_URL: "http://127.0.0.1:49267" },
        }),
      ).toMatchObject({
        trustedOrigins: [
          "http://127.0.0.1:49267",
          "http://localhost:49267",
        ],
      });
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("拒绝已经存在但为空的持久化 Secret 文件", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "huddletab-auth-config-"));

    try {
      writeFileSync(join(dataDir, "auth-secret"), "\n", "utf8");

      expect(() => resolveAuthRuntimeConfig({ dataDir, env: {} })).toThrow(
        "认证密钥文件为空，请修复后重试。",
      );
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
