import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("单元测试门禁", () => {
  it("仅以单 worker 串行执行一次 tests/unit 套件", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve("package.json"), "utf8"),
    ) as { scripts: { "test:unit": string } };

    expect(packageJson.scripts["test:unit"]).toBe(
      "vitest run tests/unit --maxWorkers=1",
    );
  });
});
