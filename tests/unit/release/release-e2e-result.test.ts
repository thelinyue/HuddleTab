import { describe, expect, test } from "vitest";

import { verifyPlaywrightResult } from "../../../scripts/verify-release-e2e-result.mjs";

describe("四日发布门禁 Playwright 报告", () => {
  test("只接受一条通过且没有跳过或失败的结果", () => {
    expect(
      verifyPlaywrightResult({
        stats: { expected: 1, skipped: 0, unexpected: 0, flaky: 0 },
        errors: [],
      }),
    ).toEqual({ passed: 1, skipped: 0, failed: 0 });
  });

  test.each([
    [{ expected: 0, skipped: 1, unexpected: 0, flaky: 0 }, "存在跳过"],
    [{ expected: 0, skipped: 0, unexpected: 1, flaky: 0 }, "存在失败"],
    [{ expected: 2, skipped: 0, unexpected: 0, flaky: 0 }, "通过数量不是 1"],
    [{ expected: 0, skipped: 0, unexpected: 0, flaky: 1 }, "存在不稳定"],
  ])("拒绝非严格单用例结果：%s", (stats, message) => {
    expect(() => verifyPlaywrightResult({ stats, errors: [] })).toThrow(
      message,
    );
  });
});
