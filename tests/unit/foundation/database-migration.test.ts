import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const migrationEntrypoint = resolve("src/server/db/migrate.ts");
const tsxEntrypoint = resolve("node_modules/tsx/dist/cli.mjs");

/**
 * 通过独立 Node 进程运行迁移入口，确保不会复用 Vitest 进程中的连接状态。
 */
function runMigrate(cwd: string) {
  return execFileAsync(process.execPath, [tsxEntrypoint, migrationEntrypoint], {
    cwd,
    env: {
      ...process.env,
      DATABASE_URL: "postgresql://huddletab:huddletab@127.0.0.1:1/huddletab",
    },
  });
}

async function expectMigrationToSkip(cwd: string) {
  const { stderr, stdout } = await runMigrate(cwd);

  expect(stdout).toContain("当前版本尚无数据库迁移，已安全跳过");
  expect(stderr).toBe("");
}

async function withTemporaryDirectory(action: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(join(tmpdir(), "huddletab-migrate-"));

  try {
    await action(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

describe("database migration foundation", () => {
  it("safely skips migration without a journal and does not connect to PostgreSQL", async () => {
    await withTemporaryDirectory(expectMigrationToSkip);
  });

  it("safely skips migration with an empty journal and does not connect to PostgreSQL", async () => {
    await withTemporaryDirectory(async (cwd) => {
      const metaFolder = join(cwd, "drizzle", "meta");
      await mkdir(metaFolder, { recursive: true });
      await writeFile(
        join(metaFolder, "_journal.json"),
        JSON.stringify({ version: "7", dialect: "postgresql", entries: [] }),
      );

      await expectMigrationToSkip(cwd);
    });
  });
});
