import assert from "node:assert/strict";
import { createWriteStream } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { yauzl, yazl } from "playwright-core/lib/zipBundle";
import { replaceArtifactFile, sanitizeArtifacts, scanArtifacts } from "./artifact-sanitizer.mjs";

const secrets = {
  username: "phase1e0123456789ab",
  password: "0123456789abcdef0123456789abcdefAa1!",
};

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
  await createZip(nestedArchive, {
    "storage-state.json": JSON.stringify({ cookies: [{ name: "huddletab_session", value: "nested-session-value" }] }),
    "csrf-response.json": JSON.stringify({ token: "nested-csrf-value" }),
    "binary-resource.bin": Buffer.concat([Buffer.from([0]), Buffer.from(secrets.username)]),
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
  assert.doesNotMatch(nestedEntries.get("binary-resource.bin").toString("latin1"), new RegExp(secrets.username));
  await rm(decodedNested);
  console.log("artifact 脱敏专项测试通过：HTML、嵌套 ZIP trace、结构化凭据与二进制成员扫描均为零。 ");
} finally {
  await rm(root, { recursive: true, force: true });
}
