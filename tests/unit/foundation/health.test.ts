import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({ sql: vi.fn() }));

import { GET } from "@/app/api/health/route";
import { sql } from "@/server/db";

/**
 * postgres.js 的 Sql 类型是高度递归的交叉类型；测试只需要 Vitest mock 的三个操作，
 * 因此收窄为最小接口，避免 typecheck 展开整个驱动类型。
 */
const sqlMock = sql as unknown as {
  mockReset(): void;
  mockResolvedValueOnce(value: unknown): void;
  mockRejectedValueOnce(error: Error): void;
};

describe("health route", () => {
  beforeEach(() => {
    sqlMock.mockReset();
  });

  it("returns ok when PostgreSQL is available", async () => {
    sqlMock.mockResolvedValueOnce([] as never);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("returns a deployer-friendly error when PostgreSQL is unavailable", async () => {
    sqlMock.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "error",
      message: "数据库连接不可用",
    });
  });
});
