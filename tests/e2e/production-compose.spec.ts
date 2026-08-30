import { execFile as executeFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { expect, test } from "@playwright/test";

const execFile = promisify(executeFile);
const runCompose = process.env.RUN_PRODUCTION_COMPOSE === "true";

test.skip(!runCompose, "仅在 WSL Docker 环境执行生产 Compose 演练");

test("首次启动进入初始化页面并自动登录管理员", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const dataRoot = await mkdtemp(join(tmpdir(), "huddletab-compose-"));
  const port = 5661 + testInfo.parallelIndex;
  const baseUrl = `http://127.0.0.1:${port}`;
  const project = `huddletab-phase10-${testInfo.parallelIndex}-${Date.now()}`;
  const environment = {
    ...process.env,
    APP_PORT: String(port),
    APP_BASE_URL: baseUrl,
    BETTER_AUTH_URL: baseUrl,
    DATA_HOST_DIR: dataRoot,
  };
  const compose = (args: readonly string[]) =>
    execFile("docker", ["compose", "-p", project, ...args], {
      cwd: process.cwd(),
      env: environment,
    });

  try {
    await compose(["up", "--build", "-d"]);
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const health = await fetch(`${baseUrl}/api/health`).catch(
        () => undefined,
      );
      if (health?.ok) break;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    const logs = (await compose(["logs", "app"])).stdout;
    expect(logs).not.toContain("Setup Token");

    await page.goto(`${baseUrl}/login`);
    await expect(page).toHaveURL(`${baseUrl}/setup`);
    await page.getByLabel("管理员昵称").fill("Phase 10 管理员");
    await page.getByLabel("用户名").fill("phase10admin");
    await page
      .getByLabel("密码", { exact: true })
      .fill("phase10-compose-password");
    await page.getByLabel("确认密码").fill("phase10-compose-password");
    await page.getByRole("button", { name: "完成初始化" }).click();
    await expect(page).toHaveURL(`${baseUrl}/activities`);

    await page.waitForFunction(
      async () => {
        await navigator.serviceWorker.ready;
        return true;
      },
      undefined,
      { timeout: 30_000 },
    );
    await page.reload();
    await expect
      .poll(() =>
        page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
      )
      .toBe(true);
    await page.goto(`${baseUrl}/activities`);
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const cache = await caches.open("huddletab-app-shell-v1");
          return (await cache.keys()).some(
            (request) => new URL(request.url).pathname === "/activities",
          );
        }),
      )
      .toBe(true);

    for (const path of [
      "/",
      "/login",
      "/login?callbackURL=%2Fjoin%2Fsecure_invite_token_123",
      "/register",
      "/register?callbackURL=%2Fjoin%2Fsecure_invite_token_123",
      "/setup",
      "/setup?source=compose",
      "/join/secure_invite_token_123?source=compose",
    ]) {
      const response = await page.goto(`${baseUrl}${path}`);
      expect(response?.status(), `访问 ${path} 应返回 HTML`).toBe(200);
    }

    for (const path of [
      "/login/help",
      "/register/invite?callbackURL=%2Fjoin%2Fsecure_invite_token_123",
      "/setup/status",
      "/join",
    ]) {
      await page.goto(`${baseUrl}${path}`);
    }

    const runtimeNavigationEntries = await page.evaluate(async () => {
      const cache = await caches.open("huddletab-app-shell-v1");
      return (await cache.keys()).map(
        (request) => new URL(request.url).pathname,
      );
    });
    expect(runtimeNavigationEntries).toContain("/activities");
    expect(runtimeNavigationEntries).toEqual(
      expect.not.arrayContaining([
        "/",
        "/login",
        "/register",
        "/setup",
        "/join",
      ]),
    );
    expect(
      runtimeNavigationEntries.some((pathname) =>
        ["/login", "/register", "/setup", "/join"].some(
          (root) => pathname === root || pathname.startsWith(`${root}/`),
        ),
      ),
    ).toBe(false);

    await page.goto(`${baseUrl}/activities`);
    expect(
      await page.evaluate(async () => (await fetch("/api/activities")).status),
    ).toBe(200);
  } finally {
    await compose(["down", "--volumes", "--remove-orphans"]).catch(
      () => undefined,
    );
    await execFile("docker", [
      "run",
      "--rm",
      "--user",
      "0:0",
      "--mount",
      `type=bind,source=${dataRoot},target=/cleanup`,
      "--entrypoint",
      "find",
      "postgres:18-alpine",
      "/cleanup",
      "-mindepth",
      "1",
      "-delete",
    ]);
    await rm(dataRoot, { recursive: true, force: true });
  }
});
