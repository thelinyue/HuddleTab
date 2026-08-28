import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { createDatabaseClient } from "@/server/db/factory";

let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;
let sql: Sql;

describe("database foundation", () => {
  beforeAll(async () => {
    // 基础数据库测试与生产部署使用同一时区，避免日期边界断言受容器默认值影响。
    container = await new PostgreSqlContainer("postgres:18-alpine")
      .withEnvironment({ TZ: "Asia/Shanghai" })
      .start();
    ({ sql } = createDatabaseClient(container.getConnectionUri(), 1));
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
    await container?.stop();
  });

  it("connects to PostgreSQL 18", async () => {
    const [result] = await sql<{ version: string }[]>`select version()`;

    expect(result.version).toContain("PostgreSQL 18");
  });
});
