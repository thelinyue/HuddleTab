import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rotateForUninitializedStartup: vi.fn(),
  create: vi.fn(),
  compensate: vi.fn(),
}));

vi.mock("@/server/db", () => ({
  getDatabaseClient: () => ({ sql: "test-sql" }),
}));
vi.mock("@/server/services/registration-service", () => ({
  createSetupCredentialUser: mocks.create,
  compensateSetupCredentialUser: mocks.compensate,
}));
vi.mock("@/server/services/setup-service", () => ({
  SetupService: class {
    rotateForUninitializedStartup = mocks.rotateForUninitializedStartup;
  },
}));

import { initializeSetup } from "@/server/bootstrap/initialize-setup";
import { startContainer } from "@/server/bootstrap/container-start";

class FakeChild extends EventEmitter {
  readonly killedSignals: NodeJS.Signals[] = [];

  kill(signal?: NodeJS.Signals) {
    if (signal) this.killedSignals.push(signal);
    return true;
  }
}

describe("初始化启动器", () => {
  it("未初始化时仅通过明确的中文部署日志输出 token 一次", async () => {
    mocks.rotateForUninitializedStartup.mockResolvedValueOnce(
      "setup-token-for-log",
    );
    const log = vi.fn();

    await initializeSetup(log);

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("仅在本次容器启动输出一次"),
      "setup-token-for-log",
    );
    expect(log.mock.calls[0]?.[0]).toContain("部署管理员");
  });

  it("已初始化时不输出 token", async () => {
    mocks.rotateForUninitializedStartup.mockResolvedValueOnce(null);
    const log = vi.fn();

    await initializeSetup(log);

    expect(log).not.toHaveBeenCalled();
  });

  it("先完成初始化，再启动 Next，并返回子进程退出码", async () => {
    const calls: string[] = [];
    const child = new FakeChild();
    const spawn = vi.fn(() => {
      calls.push("spawn");
      queueMicrotask(() => child.emit("exit", 0, null));
      return child;
    });

    await expect(
      startContainer(
        async () => {
          calls.push("initialize");
        },
        spawn as unknown as typeof import("node:child_process").spawn,
      ),
    ).resolves.toBe(0);

    expect(calls).toEqual(["initialize", "spawn"]);
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "start",
        "-H",
        "0.0.0.0",
        "-p",
        "5660",
      ],
      expect.objectContaining({ stdio: "inherit", env: process.env }),
    );
  });

  it("将 Docker 终止信号转交给 Next 子进程", async () => {
    const child = new FakeChild();
    const spawn = vi.fn(() => child);
    const started = startContainer(
      async () => {},
      spawn as unknown as typeof import("node:child_process").spawn,
    );

    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    process.emit("SIGTERM");
    expect(child.killedSignals).toEqual(["SIGTERM"]);
    child.emit("exit", null, "SIGTERM");

    await expect(started).resolves.toBe(1);
  });

  it("子进程退出后清理转发的信号监听器", async () => {
    const listenersBefore = process.listenerCount("SIGTERM");
    const child = new FakeChild();
    const start = startContainer(
      async () => {},
      vi.fn(() => {
        queueMicrotask(() => child.emit("exit", 0, null));
        return child;
      }) as unknown as typeof import("node:child_process").spawn,
    );

    await expect(start).resolves.toBe(0);

    expect(process.listenerCount("SIGTERM")).toBe(listenersBefore);
  });
});

describe("Docker 运行时命令", () => {
  it("入口脚本保持唯一迁移职责，CMD 只启动 container 启动器", async () => {
    const dockerfile = await readFile(resolve("Dockerfile"), "utf8");
    const entrypoint = await readFile(resolve("docker-entrypoint.sh"), "utf8");

    expect(entrypoint).toContain("npm run db:migrate");
    expect(dockerfile).toContain('CMD ["npm", "run", "start:container"]');
    expect(dockerfile).not.toContain("db:migrate && npm run start:container");
    expect(dockerfile).toContain("/app/tsconfig.json ./tsconfig.json");
    expect(dockerfile).toContain("/app/src/server ./src/server");
  });
});
