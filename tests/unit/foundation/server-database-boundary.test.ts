import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const tsxEntrypoint = resolve("node_modules/tsx/dist/cli.mjs");
const databaseRuntimeEntrypoint = resolve("src/server/db/client.ts");
const productionSingletonScript = [
  `import { getDatabaseClient } from ${JSON.stringify(pathToFileURL(databaseRuntimeEntrypoint).href)};`,
  "const first = getDatabaseClient();",
  "const second = getDatabaseClient();",
  'console.log(first === second ? "production database singleton reused" : "production database singleton not reused");',
].join("\n");

describe("server database boundary", () => {
  it("rejects a direct Node import of the database runtime entrypoint", async () => {
    await expect(
      execFileAsync(
        process.execPath,
        [tsxEntrypoint, databaseRuntimeEntrypoint],
        {
          env: { ...process.env },
        },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Client Component"),
    });
  });

  /**
   * 子进程使用 react-server 条件加载运行时模块，避免污染 Vitest 父进程的 globalThis。
   * postgres.js 只有执行查询才会建连；这里仅构造客户端并比较引用，且使用不可达端口。
   */
  it("reuses the lazy database client in production without opening a connection", async () => {
    const fixtureDirectory = await mkdtemp(
      join(tmpdir(), "huddletab-db-client-"),
    );
    const fixturePath = join(fixtureDirectory, "production-singleton.ts");

    try {
      await writeFile(fixturePath, productionSingletonScript);
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        ["--conditions=react-server", "--import", "tsx", fixturePath],
        {
          env: {
            ...process.env,
            NODE_ENV: "production",
            DATABASE_URL:
              "postgresql://huddletab:test-password@127.0.0.1:1/huddletab",
          },
        },
      );

      expect(stdout).toContain("production database singleton reused");
      expect(stderr).toBe("");
    } finally {
      await rm(fixtureDirectory, { recursive: true, force: true });
    }
  });
});
