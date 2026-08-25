import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("单元测试门禁", () => {
  it("以单 worker 串行执行既有 tests/unit 套件", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve("package.json"), "utf8"),
    ) as { scripts: { "test:unit": string } };

    expect(packageJson.scripts["test:unit"]).toContain("vitest run tests/unit");
    expect(packageJson.scripts["test:unit"]).toContain("--maxWorkers=1");
  });
});
