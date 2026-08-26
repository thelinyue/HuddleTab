import { readFile } from "node:fs/promises";

import { expect, it } from "vitest";

/** PostgreSQL 18 服务端只能由同版本或更高版本的 pg_dump 生成可恢复归档。 */
it("生产镜像安装与 PostgreSQL 18 服务端兼容的客户端工具", async () => {
  const dockerfile = await readFile("Dockerfile", "utf8");

  expect(dockerfile).toContain("postgresql-client-18");
});
