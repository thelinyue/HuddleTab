import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { createDatabaseClient } from "@/server/db/client";

let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;
let sql: Sql;

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
});