import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

/**
 * 发布门禁不接受 skip、重试后 flaky 或额外测试。这里校验 Playwright JSON 的事实，
 * 避免测试命令因全部跳过仍以退出码 0 结束。
 */
export function verifyPlaywrightResult(report) {
  const stats = report?.stats ?? {};
  if (stats.skipped !== 0) throw new Error("发布门禁存在跳过的测试。");
  if (stats.unexpected !== 0 || (report?.errors?.length ?? 0) > 0)
    throw new Error("发布门禁存在失败的测试。");
  if (stats.flaky !== 0) throw new Error("发布门禁存在不稳定的测试。");
  if (stats.expected !== 1) throw new Error("发布门禁通过数量不是 1。");
  return { passed: 1, skipped: 0, failed: 0 };
}

async function main() {
  const reportPath = process.argv[2];
  if (!reportPath) throw new Error("请提供 Playwright JSON 报告路径。");
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const result = verifyPlaywrightResult(report);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "发布门禁报告校验失败。"}\n`,
    );
    process.exitCode = 1;
  });
}
