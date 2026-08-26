import { execFile as executeFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { expect, test } from "@playwright/test";

const execFile = promisify(executeFile);
const runCompose = process.env.RUN_PRODUCTION_COMPOSE === "true";

test.skip(!runCompose, "仅在 WSL Docker 环境执行生产 Compose 演练");

test("首次启动仅在容器日志输出一次 Setup Token", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "huddletab-compose-"));
  const project = `huddletab-phase10-${Date.now()}`;
  const environment = {
    ...process.env,
    APP_PORT: "5661",
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
    let logs = "";
    while (Date.now() < deadline) {
      logs = (await compose(["logs", "app"])).stdout;
      if (logs.includes("Setup Token")) break;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    const warnings = logs
      .split("\n")
      .filter(
        (line) =>
          line.includes("Setup Token") &&
          line.includes("容器日志仅应向部署管理员开放"),
      );
    expect(warnings).toHaveLength(1);
    const token = warnings[0]!.match(/：([^\s]+)/)?.[1];
    expect(token).toBeTruthy();

    const setup = await fetch("http://127.0.0.1:5661/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        setupToken: token,
        username: "phase10admin",
        password: "phase10-compose-password",
        nickname: "Phase 10 管理员",
      }),
    });
    expect(setup.status).toBe(201);

    const restartedAt = new Date().toISOString();
    await compose(["restart", "app"]);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const restartedLogs = (
      await compose(["logs", "--since", restartedAt, "app"])
    ).stdout;
    expect(restartedLogs).not.toContain("Setup Token");
  } finally {
    await compose(["down", "--volumes", "--remove-orphans"]).catch(
      () => undefined,
    );
    await rm(dataRoot, { recursive: true, force: true });
  }
});
