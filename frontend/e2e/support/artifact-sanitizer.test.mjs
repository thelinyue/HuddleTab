import assert from "node:assert/strict";
import { createWriteStream } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { yauzl, yazl } from "playwright-core/lib/zipBundle";
import { sanitizeArtifacts, scanArtifacts } from "./artifact-sanitizer.mjs";

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

const root = await mkdtemp(path.join(os.tmpdir(), "huddletab-artifact-sanitizer-"));
try {
  const reportDir = path.join(root, "playwright-report");
  const resultDir = path.join(root, "test-results", "failure");
  await mkdir(reportDir, { recursive: true });
  await mkdir(resultDir, { recursive: true });
  const embeddedReport = path.join(root, "embedded-report.zip");
  await createZip(embeddedReport, {
    "report.json": JSON.stringify({ username: secrets.username, password: secrets.password, cookie: "huddletab_session=session-value", csrf: "X-CSRF-Token: csrf-value" }),
  });
  const embeddedBase64 = (await readFile(embeddedReport)).toString("base64");
  await rm(embeddedReport);
  await writeFile(path.join(reportDir, "index.html"), `<div>${secrets.username}</div><script id="playwrightReportBase64" type="application/zip">data:application/zip;base64,${embeddedBase64}</script>`);
  await writeFile(path.join(resultDir, "test-failed-1.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  await createZip(path.join(resultDir, "trace.zip"), {
    "trace.trace": JSON.stringify({ method: "fill", params: { value: secrets.password }, selector: `用户名 ${secrets.username}` }),
    "trace.network": JSON.stringify({ headers: [{ name: "cookie", value: "huddletab_session=session-value" }, { name: "x-csrf-token", value: "csrf-value" }] }),
    "resources/page.html": `<span>@${secrets.username}</span>`,
  });

  const patternFindings = await scanArtifacts(root, []);
  assert.ok(patternFindings.some((finding) => finding.endsWith(":temporary-username")));
  assert.ok(patternFindings.some((finding) => finding.endsWith(":temporary-password")));
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
  await rm(decodedReport);
  assert.equal((await readFile(path.join(resultDir, "test-failed-1.png"))).length, 8);
  const trace = await readZip(path.join(resultDir, "trace.zip"));
  assert.ok(trace.has("trace.trace"));
  assert.ok(trace.has("trace.network"));
  assert.ok(trace.has("resources/page.html"));
  assert.match(trace.get("trace.network").toString("utf8"), /\[REDACTED\]/);
  console.log("artifact 脱敏专项测试通过：HTML、ZIP trace 与 screenshot 均保留，敏感扫描为零。 ");
} finally {
  await rm(root, { recursive: true, force: true });
}
