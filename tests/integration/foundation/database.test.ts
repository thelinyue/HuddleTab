import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { createDatabaseClient } from "@/server/db/factory";

const execFileAsync = promisify(execFile);
const migrationEntrypoint = resolve("src/server/db/migrate.ts");
const tsxEntrypoint = resolve("node_modules/tsx/dist/cli.mjs");

let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;
let sql: Sql;

/** 在独立进程运行正式迁移入口，确保测试覆盖 CLI 的 journal 校验、建连和关闭流程。 */
async function runMigrate(cwd: string, databaseUrl: string) {
  return execFileAsync(process.execPath, [tsxEntrypoint, migrationEntrypoint], {
    cwd,
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}

async function withMigrationFixture(action: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(join(tmpdir(), "huddletab-migration-"));
  const metaFolder = join(cwd, "drizzle", "meta");

  try {
    await mkdir(metaFolder, { recursive: true });
    await writeFile(
      join(metaFolder, "_journal.json"),
      JSON.stringify({
        version: "7",
        dialect: "postgresql",
        entries: [
          {
            idx: 0,
            version: "7",
            when: Date.now(),
            tag: "0000_task4_migration_probe",
            breakpoints: true,
          },
        ],
      }),
    );
    await writeFile(
      join(cwd, "drizzle", "0000_task4_migration_probe.sql"),
      "CREATE TABLE huddletab_task4_migration_probe (id integer PRIMARY KEY);\n",
    );

    await action(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

describe("database foundation", () => {
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:18-alpine").start();
    ({ sql } = createDatabaseClient(container.getConnectionUri(), 1));
  }, 60_000);

  afterAll(async () => {
    await sql.end();
    await container.stop();
  });

  it("connects to PostgreSQL 18", async () => {
    const [result] = await sql<{ version: string }[]>`select version()`;
    expect(result.version).toContain("PostgreSQL 18");
  });

  it("runs a valid journal and SQL migration through the production CLI", async () => {
    await withMigrationFixture(async (cwd) => {
      const { stdout, stderr } = await runMigrate(
        cwd,
        container.getConnectionUri(),
      );

      expect(stdout).toContain("数据库迁移完成");
      expect(stderr).toBe("");

      const [table] = await sql<{ name: string | null }[]>`
        select to_regclass('public.huddletab_task4_migration_probe') as name
      `;
      const [migration] = await sql<{ count: number }[]>`
        select count(*)::int as count from drizzle.__drizzle_migrations
      `;

      expect(table.name).toBe("huddletab_task4_migration_probe");
      expect(migration.count).toBe(1);
    });
  });
});
