import { expect, test } from "vitest";

import { isAppShellCacheable } from "@/pwa/service-worker/app-shell-cache";

test("App Shell 缓存不包含 API、认证或附件响应", () => {
  const origin = "https://huddletab.example";

  expect(isAppShellCacheable(new URL(`${origin}/activities/a1`), origin)).toBe(
    true,
  );
  expect(
    isAppShellCacheable(new URL(`${origin}/_next/static/app.js`), origin),
  ).toBe(true);
  expect(
    isAppShellCacheable(
      new URL(`${origin}/api/activities/a1/expenses`),
      origin,
    ),
  ).toBe(false);
  expect(
    isAppShellCacheable(new URL(`${origin}/api/auth/get-session`), origin),
  ).toBe(false);
  expect(
    isAppShellCacheable(
      new URL(`${origin}/api/activities/a1/expenses/e1/attachments`),
      origin,
    ),
  ).toBe(false);
});
