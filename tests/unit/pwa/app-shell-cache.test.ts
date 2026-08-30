import { expect, test } from "vitest";

import { isNavigationCacheable } from "@/pwa/service-worker/navigation-cache-boundary";

test("运行时导航缓存排除状态敏感路径和跨域响应", () => {
  const origin = "https://huddletab.example";

  for (const path of [
    "/activities",
    "/activities/a1?tab=expenses",
    "/admin/system",
    "/share-summary/a1",
    "/_next/static/app.js",
    "/login-help",
    "/register-info",
    "/setupper",
    "/joiner/invite-token",
  ]) {
    expect(isNavigationCacheable(new URL(`${origin}${path}`), origin)).toBe(
      true,
    );
  }

  for (const path of [
    "/",
    "/?from=offline",
    "/login",
    "/login?callbackURL=%2Fjoin%2Ftoken",
    "/login/help",
    "/register",
    "/register?callbackURL=%2Fjoin%2Ftoken",
    "/register/invite",
    "/setup",
    "/setup/status",
    "/join",
    "/join/invite-token",
    "/api/auth/get-session",
    "/api/activities/a1/expenses/e1/attachments",
  ]) {
    expect(isNavigationCacheable(new URL(`${origin}${path}`), origin)).toBe(
      false,
    );
  }

  expect(
    isNavigationCacheable(
      new URL("https://other.example/activities/a1"),
      origin,
    ),
  ).toBe(false);
});
