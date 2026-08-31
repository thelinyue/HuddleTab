import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

describe("database migration foundation", () => {
  it("safely skips without a migration journal or database connection", () => {
    const emptyWorkspace = mkdtempSync(join(tmpdir(), "huddletab-migrate-"));

    try {
      const result = spawnSync(
        process.execPath,
        [resolve("src/server/db/migrate.ts")],
        {
          cwd: emptyWorkspace,
          encoding: "utf8",
          env: { ...process.env, DATABASE_URL: "" },
        },
      );

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("当前版本尚无数据库迁移，已安全跳过");
    } finally {
      rmSync(emptyWorkspace, { recursive: true, force: true });
    }
  });
});
