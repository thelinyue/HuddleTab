import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../core.spec.ts", import.meta.url), "utf8");

assert.match(source, /async function createConflictPages\(browser: Browser, testInfo: TestInfo, storageState: StorageState\)/);
assert.equal(source.match(/browser\.newContext\(/g)?.length, 2, "每个冲突方必须分别创建 BrowserContext。");
assert.doesNotMatch(source, /async function (?:expense|settlement)Conflict\(context: BrowserContext/);
assert.match(source, /\.\.\.testInfo\.project\.use/);
assert.equal(source.match(/expect\(conflictResponse\.status\(\)\)\.toBe\(409\)/g)?.length, 2, "Expense 和 Settlement 都必须断言真实 HTTP 409。");

console.log("并发上下文专项测试通过：两个独立 context 继承 project options，两个冲突均断言 HTTP 409。");
