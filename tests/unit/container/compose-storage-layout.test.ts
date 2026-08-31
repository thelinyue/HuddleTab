import { readFile } from "node:fs/promises";

import { expect, it } from "vitest";

it("两个 Compose 配置将数据库和应用持久化目录分开挂载", async () => {
  const [compose, releaseCompose] = await Promise.all([
    readFile("compose.yaml", "utf8"),
    readFile("compose.release.yaml", "utf8"),
  ]);

  expect(compose).toContain(
    "- ${DATA_HOST_DIR:-./data}/postgres:/var/lib/postgresql",
  );
  expect(compose).toContain("- ${DATA_HOST_DIR:-./data}/app:/data");
  expect(compose).not.toContain("- ${DATA_HOST_DIR:-./data}:/data");

  expect(releaseCompose).toContain(
    "- ./huddletab-data/postgres:/var/lib/postgresql",
  );
  expect(releaseCompose).toContain("- ./huddletab-data/app:/data");
  expect(releaseCompose).not.toContain("- ./huddletab-data:/data");
});
