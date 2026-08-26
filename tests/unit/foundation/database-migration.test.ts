import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("database migration foundation", () => {
  it("safely skips without a migration journal or database connection", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/server/db/migrate.ts"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, DATABASE_URL: "" },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("当前版本尚无数据库迁移，已安全跳过");
  });
});
