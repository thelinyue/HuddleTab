import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const composePath = resolve("compose.yaml");

/** 只截取 PostgreSQL healthcheck，避免环境变量默认值等相邻配置干扰断言。 */
async function readPostgresHealthcheck() {
  const compose = await readFile(composePath, "utf8");
  const postgresStart = compose.indexOf("  postgres:");
  const appStart = compose.indexOf("\n  app:", postgresStart);
  const postgresService = compose.slice(postgresStart, appStart);
  const healthcheckStart = postgresService.indexOf("    healthcheck:");
  const healthcheckEnd = postgresService.indexOf(
    "\n      interval:",
    healthcheckStart,
  );

  return postgresService.slice(healthcheckStart, healthcheckEnd);
}

describe("Docker Compose PostgreSQL healthcheck", () => {
  it("在容器内展开并安全引用用户名和数据库名", async () => {
    const healthcheck = await readPostgresHealthcheck();
    const expectedCommand =
      'pg_isready -U "$${POSTGRES_USER}" -d "$${POSTGRES_DB}"';

    expect(healthcheck.includes(expectedCommand)).toBe(true);
  });
});
