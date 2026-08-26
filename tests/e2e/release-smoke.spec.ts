import { expect, test } from "@playwright/test";

/** 静态发布边界不应因本地没有 PostgreSQL 而无法验证。 */
test("生产安全响应头和 PWA 端点可用", async ({ request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);

  const page = await request.get("/");
  expect(page.headers()["x-content-type-options"]).toBe("nosniff");
  expect(page.headers()["content-security-policy"]).toContain(
    "default-src 'self'",
  );
  expect(page.headers()["x-frame-options"]).toBe("DENY");
  expect(page.headers()["referrer-policy"]).toBe(
    "strict-origin-when-cross-origin",
  );
});

/** 健康端点必须在真实数据库部署中返回 200，不能由无数据库的静态 E2E 代替。 */
test("生产健康端点可查询数据库", async ({ request }) => {
  test.skip(
    !process.env.PLAYWRIGHT_BASE_URL,
    "健康检查需要由 PLAYWRIGHT_BASE_URL 指向真实 PostgreSQL 部署。",
  );
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
});
