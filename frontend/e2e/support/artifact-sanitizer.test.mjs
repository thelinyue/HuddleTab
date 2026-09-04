import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { crc32 } from "node:zlib";
import { chromium } from "playwright";
import { PNG } from "playwright-core/lib/utilsBundle";
import { yauzl, yazl } from "playwright-core/lib/zipBundle";
import { replaceArtifactFile, sanitizeArtifacts, scanArtifacts } from "./artifact-sanitizer.mjs";

const secrets = {
  username: "phase1e0123456789ab",
  password: "0123456789abcdef0123456789abcdefAa1!",
};
const execFileAsync = promisify(execFile);
const frontendDir = fileURLToPath(new URL("../..", import.meta.url));
const require = createRequire(import.meta.url);

function createZip(file, entries) {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    zip.outputStream.pipe(createWriteStream(file)).on("close", resolve).on("error", reject);
    for (const [name, value] of Object.entries(entries)) zip.addBuffer(Buffer.from(value), name);
    zip.end();
  });
}

function readZip(file) {
  return new Promise((resolve, reject) => {
    const entries = new Map();
    yauzl.open(file, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      zip.readEntry();
      zip.on("entry", (entry) => {
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return reject(streamError);
          const chunks = [];
          stream.on("data", (chunk) => chunks.push(chunk));
          stream.on("end", () => {
            entries.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.on("end", () => resolve(entries));
      zip.on("error", reject);
    });
  });
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function addPngText(png, text) {
  const iend = png.lastIndexOf(Buffer.from("IEND", "ascii")) - 4;
  assert.ok(iend >= 8, "PNG 缺少 IEND chunk。");
  return Buffer.concat([png.subarray(0, iend), pngChunk("tEXt", Buffer.from(`Comment\0${text}`)), png.subarray(iend)]);
}

async function filesUnder(root) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name));
}

async function createRealPlaywrightArtifacts(root) {
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "huddletab-artifact-playwright-source-"));
  const reportDir = path.join(root, "playwright-report");
  const resultDir = path.join(root, "test-results");
  const config = path.join(sourceRoot, "playwright.config.cjs");
  const spec = path.join(sourceRoot, "fixture.spec.cjs");
  const playwrightTest = path.join(frontendDir, "node_modules", "@playwright", "test");
  try {
    await writeFile(config, `
      const { defineConfig } = require(${JSON.stringify(playwrightTest)});
      module.exports = defineConfig({
        testDir: ${JSON.stringify(sourceRoot)},
        testMatch: "fixture.spec.cjs",
        outputDir: ${JSON.stringify(resultDir)},
        workers: 1,
        reporter: [["html", { outputFolder: ${JSON.stringify(reportDir)}, open: "never" }]],
        use: { trace: "on" },
      });
    `);
    await writeFile(spec, `
      const { test } = require(${JSON.stringify(playwrightTest)});
      test("real artifact fixture", async ({ page }, testInfo) => {
        await page.setContent('<style>input { color: transparent !important; -webkit-text-fill-color: transparent !important; }</style><label>用户名<input autocomplete="username"></label>');
        await page.getByLabel("用户名").fill(${JSON.stringify(secrets.username)});
        const screenshot = testInfo.outputPath("masked.png");
        await page.screenshot({ path: screenshot });
        await testInfo.attach("masked screenshot", { path: screenshot, contentType: "image/png" });
      });
    `);
    const cli = path.join(frontendDir, "node_modules", "@playwright", "test", "cli.js");
    await execFileAsync(process.execPath, [cli, "test", "--config", config], {
      cwd: frontendDir,
      env: { ...process.env, FORCE_COLOR: "0" },
      maxBuffer: 10 * 1024 * 1024,
    });
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
  }

  const files = await filesUnder(root);
  const screenshot = files.find((file) => file.endsWith(`${path.sep}masked.png`));
  const trace = files.find((file) => file.endsWith(`${path.sep}trace.zip`));
  assert.ok(screenshot, "真实 Playwright screenshot 未生成。");
  assert.ok(trace, "真实 Playwright trace 未生成。");
  return { reportDir, screenshot, trace };
}

async function assertPlaywrightViewersCanLoad({ reportDir, trace }) {
  const browser = await chromium.launch({ headless: true });
  const traceViewerPath = path.join(frontendDir, "node_modules", "playwright-core", "lib", "server", "trace", "viewer", "traceViewer.js");
  const { installRootRedirect, startTraceViewerServer } = require(traceViewerPath);
  const server = await startTraceViewerServer({ host: "127.0.0.1", port: 0 });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(reportDir, "index.html")).href);
    await page.getByText("real artifact fixture", { exact: true }).waitFor({ timeout: 15_000 });
    await installRootRedirect(server, [trace], {});
    await page.goto(server.urlPrefix("precise"));
    await page.locator(".action-title").first().waitFor({ timeout: 15_000 });
  } finally {
    await server.stop();
    await browser.close();
  }
}

const rollbackRoot = await mkdtemp(path.join(os.tmpdir(), "huddletab-artifact-rollback-"));
try {
  const original = path.join(rollbackRoot, "trace.zip");
  const replacement = path.join(rollbackRoot, "trace.zip.sanitized");
  await writeFile(original, "original artifact");
  await writeFile(replacement, "sanitized artifact");
  let renameCalls = 0;
  await assert.rejects(
    replaceArtifactFile(original, replacement, {
      rename: async (source, destination) => {
        renameCalls += 1;
        if (renameCalls === 2) throw new Error("模拟替换 rename 失败");
        await rename(source, destination);
      },
    }),
    /模拟替换 rename 失败/,
  );
  assert.equal(await readFile(original, "utf8"), "original artifact");
  assert.equal(await readFile(replacement, "utf8"), "sanitized artifact");
  assert.deepEqual((await readdir(rollbackRoot)).sort(), ["trace.zip", "trace.zip.sanitized"]);
} finally {
  await rm(rollbackRoot, { recursive: true, force: true });
}

const unknownBinaryRoot = await mkdtemp(path.join(os.tmpdir(), "huddletab-artifact-unknown-binary-"));
try {
  const unknownBinary = path.join(unknownBinaryRoot, "attachment.bin");
  const original = Buffer.concat([Buffer.from([0, 1, 2, 3]), Buffer.from(secrets.username)]);
  await writeFile(unknownBinary, original);
  await assert.rejects(
    sanitizeArtifacts(unknownBinaryRoot, [secrets.username]),
    /未知二进制 artifact 含敏感数据，无法安全脱敏/,
  );
  assert.deepEqual(await readFile(unknownBinary), original);
  await rm(unknownBinary);

  const traceWithUnknownBinary = path.join(unknownBinaryRoot, "trace.zip");
  await createZip(traceWithUnknownBinary, { "resources/attachment.bin": original });
  const originalTrace = await readFile(traceWithUnknownBinary);
  await assert.rejects(
    sanitizeArtifacts(unknownBinaryRoot, [secrets.username]),
    /未知二进制 artifact 含敏感数据，无法安全脱敏/,
  );
  assert.deepEqual(await readFile(traceWithUnknownBinary), originalTrace);
} finally {
  await rm(unknownBinaryRoot, { recursive: true, force: true });
}

const root = await mkdtemp(path.join(os.tmpdir(), "huddletab-artifact-sanitizer-"));
try {
  const reportDir = path.join(root, "playwright-report");
  const resultDir = path.join(root, "test-results", "failure");
  await mkdir(reportDir, { recursive: true });
  await mkdir(resultDir, { recursive: true });
  const embeddedReport = path.join(root, "embedded-report.zip");
  await createZip(embeddedReport, {
    "report.json": JSON.stringify({
      username: secrets.username,
      password: secrets.password,
      storageState: { cookies: [{ name: "huddletab_session", value: "html-session-value" }] },
      csrfResponse: { token: "html-csrf-value" },
    }),
  });
  const embeddedBase64 = (await readFile(embeddedReport)).toString("base64");
  await rm(embeddedReport);
  await writeFile(path.join(reportDir, "index.html"), `<div>${secrets.username}</div><script id="playwrightReportBase64" type="application/zip">data:application/zip;base64,${embeddedBase64}</script>`);
  const nestedArchive = path.join(root, "nested.zip");
  const pngPixels = Buffer.from([255, 0, 0, 255, 0, 128, 255, 255]);
  const validPng = PNG.sync.write({ width: 2, height: 1, data: pngPixels });
  const pngWithSensitiveMetadata = addPngText(validPng, secrets.username);
  assert.deepEqual(PNG.sync.read(pngWithSensitiveMetadata).data, pngPixels);
  await createZip(nestedArchive, {
    "storage-state.json": JSON.stringify({ cookies: [{ name: "huddletab_session", value: "nested-session-value" }] }),
    "csrf-response.json": JSON.stringify({ token: "nested-csrf-value" }),
    "resources/screenshot.png": pngWithSensitiveMetadata,
  });
  const nestedBuffer = await readFile(nestedArchive);
  await rm(nestedArchive);
  await createZip(path.join(resultDir, "trace.zip"), {
    "trace.trace": JSON.stringify({ method: "fill", params: { value: secrets.password }, selector: `用户名 ${secrets.username}` }),
    "trace.network": JSON.stringify({ storageState: { cookies: [{ name: "huddletab_session", value: "trace-session-value" }] }, response: { token: "trace-csrf-value" } }),
    "resources/page.html": `<span>@${secrets.username}</span>`,
    "resources/nested.zip": nestedBuffer,
  });

  const patternFindings = await scanArtifacts(root, []);
  assert.ok(patternFindings.some((finding) => finding.endsWith(":temporary-username")));
  assert.ok(patternFindings.some((finding) => finding.endsWith(":temporary-password")));
  assert.ok(patternFindings.some((finding) => finding.endsWith(":session-cookie")));
  assert.ok(patternFindings.some((finding) => finding.endsWith(":csrf-token")));
  const result = await sanitizeArtifacts(root, [secrets.username, secrets.password]);
  assert.ok(result.filesSanitized >= 2);
  assert.deepEqual(await scanArtifacts(root, [secrets.username, secrets.password]), []);
  const sanitizedReport = await readFile(path.join(reportDir, "index.html"), "utf8");
  assert.match(sanitizedReport, /\[REDACTED\]/);
  const sanitizedBase64 = sanitizedReport.match(/data:application\/zip;base64,([^<]+)/)?.[1];
  assert.ok(sanitizedBase64);
  const decodedReport = path.join(root, "decoded-report.zip");
  await writeFile(decodedReport, Buffer.from(sanitizedBase64, "base64"));
  const reportEntries = await readZip(decodedReport);
  assert.match(reportEntries.get("report.json").toString("utf8"), /\[REDACTED\]/);
  assert.doesNotMatch(reportEntries.get("report.json").toString("utf8"), new RegExp(secrets.username));
  assert.doesNotMatch(reportEntries.get("report.json").toString("utf8"), /html-(?:session|csrf)-value/);
  await rm(decodedReport);
  const trace = await readZip(path.join(resultDir, "trace.zip"));
  assert.ok(trace.has("trace.trace"));
  assert.ok(trace.has("trace.network"));
  assert.ok(trace.has("resources/page.html"));
  assert.ok(trace.has("resources/nested.zip"));
  assert.match(trace.get("trace.network").toString("utf8"), /\[REDACTED\]/);
  assert.doesNotMatch(trace.get("trace.network").toString("utf8"), /trace-(?:session|csrf)-value/);
  const decodedNested = path.join(root, "decoded-nested.zip");
  await writeFile(decodedNested, trace.get("resources/nested.zip"));
  const nestedEntries = await readZip(decodedNested);
  assert.doesNotMatch(nestedEntries.get("storage-state.json").toString("utf8"), /nested-session-value/);
  assert.doesNotMatch(nestedEntries.get("csrf-response.json").toString("utf8"), /nested-csrf-value/);
  const sanitizedPng = PNG.sync.read(nestedEntries.get("resources/screenshot.png"));
  assert.equal(sanitizedPng.width, 2);
  assert.equal(sanitizedPng.height, 1);
  assert.deepEqual(sanitizedPng.data, pngPixels);
  assert.doesNotMatch(nestedEntries.get("resources/screenshot.png").toString("latin1"), new RegExp(secrets.username));
  await rm(decodedNested);
  console.log("artifact 脱敏专项测试通过：HTML、嵌套 ZIP trace、结构化凭据与二进制成员扫描均为零。 ");
} finally {
  await rm(root, { recursive: true, force: true });
}

const realArtifactRoot = await mkdtemp(path.join(os.tmpdir(), "huddletab-real-playwright-artifacts-"));
try {
  const artifacts = await createRealPlaywrightArtifacts(realArtifactRoot);
  const screenshotBefore = PNG.sync.read(await readFile(artifacts.screenshot));
  await writeFile(artifacts.screenshot, addPngText(await readFile(artifacts.screenshot), secrets.username));
  assert.ok((await scanArtifacts(realArtifactRoot, [secrets.username])).length > 0);
  await sanitizeArtifacts(realArtifactRoot, [secrets.username]);
  assert.deepEqual(await scanArtifacts(realArtifactRoot, [secrets.username]), []);
  const screenshotAfter = PNG.sync.read(await readFile(artifacts.screenshot));
  assert.equal(screenshotAfter.width, screenshotBefore.width);
  assert.equal(screenshotAfter.height, screenshotBefore.height);
  assert.deepEqual(screenshotAfter.data, screenshotBefore.data);
  await assertPlaywrightViewersCanLoad(artifacts);
  console.log("真实 Playwright artifact 验证通过：PNG 像素保持，trace 与 HTML report 均可加载。");
} finally {
  await rm(realArtifactRoot, { recursive: true, force: true });
}
