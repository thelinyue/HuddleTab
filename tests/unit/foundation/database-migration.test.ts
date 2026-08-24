import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const migrationEntrypoint = resolve("src/server/db/migrate.ts");
const tsxEntrypoint = resolve("node_modules/tsx/dist/cli.mjs");
const safeSkipMessage = "当前版本尚无数据库迁移，已安全跳过";
const failedMessage = "数据库迁移失败";

type MigrationResult = { exitCode: number; stdout: string; stderr: string };

/** 通过独立 Node 进程运行迁移入口，避免复用 Vitest 进程的环境变量和连接状态。 */
async function runMigrate(
  cwd: string,
  databaseUrl?: string,
): Promise<MigrationResult> {
  const env = { ...process.env };
  if (databaseUrl === undefined) {
    delete env.DATABASE_URL;
  } else {
    env.DATABASE_URL = databaseUrl;
  }

  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [tsxEntrypoint, migrationEntrypoint],
      { cwd, env },
    );
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const result = error as Error & {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      exitCode: result.code ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  }
}

async function withTemporaryDirectory(action: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(join(tmpdir(), "huddletab-migrate-"));

  try {
    await action(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

async function writeJournal(cwd: string, content: string) {
  const metaFolder = join(cwd, "drizzle", "meta");
  await mkdir(metaFolder, { recursive: true });
  await writeFile(join(metaFolder, "_journal.json"), content);
}

function combinedOutput(result: MigrationResult) {
  return `${result.stdout}\n${result.stderr}`;
}

describe("database migration foundation", () => {
  it("safely skips without a journal, DATABASE_URL, or a database connection", async () => {
    await withTemporaryDirectory(async (cwd) => {
      const result = await runMigrate(cwd);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(safeSkipMessage);
      expect(result.stderr).toBe("");
    });
  });

  it("safely skips an empty journal without DATABASE_URL or a database connection", async () => {
    await withTemporaryDirectory(async (cwd) => {
      await writeJournal(
        cwd,
        JSON.stringify({ version: "7", dialect: "postgresql", entries: [] }),
      );

      const result = await runMigrate(cwd);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(safeSkipMessage);
      expect(result.stderr).toBe("");
    });
  });

  it("fails safely when the migration journal is invalid JSON", async () => {
    await withTemporaryDirectory(async (cwd) => {
      await writeJournal(cwd, "{");

      const result = await runMigrate(cwd);

      expect(result.exitCode).not.toBe(0);
      expect(combinedOutput(result)).toContain(failedMessage);
      expect(combinedOutput(result)).toContain("迁移日志");
    });
  });

  it.each(["{}", '{"entries":{}}', '{"entries":null}'])(
    "fails safely when the migration journal entries are missing or not an array: %s",
    async (journal) => {
      await withTemporaryDirectory(async (cwd) => {
        await writeJournal(cwd, journal);

        const result = await runMigrate(cwd);

        expect(result.exitCode).not.toBe(0);
        expect(combinedOutput(result)).toContain(failedMessage);
        expect(combinedOutput(result)).toContain("迁移日志");
      });
    },
  );

  it("fails safely for a journal with entries but no DATABASE_URL", async () => {
    await withTemporaryDirectory(async (cwd) => {
      await writeJournal(cwd, '{"entries":[{}]}');

      const result = await runMigrate(cwd);

      expect(result.exitCode).not.toBe(0);
      expect(combinedOutput(result)).toContain(failedMessage);
      expect(combinedOutput(result)).toContain("数据库连接配置无效");
    });
  });

  it("does not leak an invalid DATABASE_URL when the journal has entries", async () => {
    const invalidDatabaseUrl = "not-a-valid-postgres-url-with-test-password";

    await withTemporaryDirectory(async (cwd) => {
      await writeJournal(cwd, '{"entries":[{}]}');

      const result = await runMigrate(cwd, invalidDatabaseUrl);
      const output = combinedOutput(result);

      expect(result.exitCode).not.toBe(0);
      expect(output).toContain(failedMessage);
      expect(output).toContain("数据库连接配置无效");
      expect(output).not.toContain(invalidDatabaseUrl);
      expect(output).not.toContain("test-password");
    });
  });
});
