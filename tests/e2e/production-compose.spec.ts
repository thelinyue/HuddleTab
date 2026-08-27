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

    await page.goto(`${baseUrl}/activities`);
    await expect(page).toHaveURL(`${baseUrl}/setup`);
    await page.getByLabel("管理员昵称").fill("Phase 10 管理员");
    await page.getByLabel("用户名").fill("phase10admin");
    await page
      .getByLabel("密码", { exact: true })
      .fill("phase10-compose-password");
    await page.getByLabel("确认密码").fill("phase10-compose-password");
    await page.getByRole("button", { name: "完成初始化" }).click();
    await expect(page).toHaveURL(`${baseUrl}/activities`);
    expect(
      await page.evaluate(async () => (await fetch("/api/activities")).status),
    ).toBe(200);
  } finally {
    await compose(["down", "--volumes", "--remove-orphans"]).catch(
      () => undefined,
    );
    await rm(dataRoot, { recursive: true, force: true });
  }
});
