import { afterEach, expect, test, vi } from "vitest";

async function readContentSecurityPolicy() {
  vi.resetModules();
  const config = (await import("../../next.config")).default;
  const headerGroups = await config.headers?.();
  const securityHeaders = headerGroups?.[0]?.headers ?? [];
  return securityHeaders.find(
    (header) => header.key === "Content-Security-Policy",
  )?.value;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

test("开发环境 CSP 允许 Next.js Webpack 使用 unsafe-eval", async () => {
  vi.stubEnv("NODE_ENV", "development");

  await expect(readContentSecurityPolicy()).resolves.toContain("'unsafe-eval'");
});

test("生产环境 CSP 不允许 unsafe-eval", async () => {
  vi.stubEnv("NODE_ENV", "production");

  await expect(readContentSecurityPolicy()).resolves.not.toContain(
    "'unsafe-eval'",
  );
});
