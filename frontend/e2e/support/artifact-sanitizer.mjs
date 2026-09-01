import { createWriteStream } from "node:fs";
import { mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extract, yazl } from "playwright-core/lib/zipBundle";

const redacted = "[REDACTED]";
const textExtensions = new Set([".css", ".html", ".json", ".jsonl", ".js", ".log", ".md", ".network", ".stacks", ".trace", ".txt", ".xml"]);

function redactText(input, secrets) {
  let output = input;
  for (const secret of secrets.filter(Boolean)) output = output.replaceAll(secret, redacted);
  output = output
    .replace(/(huddletab_(?:session|pre_auth)=)(?!\[REDACTED\])[^\s;"'<]+/gi, `$1${redacted}`)
    .replace(/((?:x-csrf-token|authorization|cookie|set-cookie)["']?\s*[:=]\s*["']?)(?!\[REDACTED\])[^\r\n"'<}]*/gi, `$1${redacted}`)
    .replace(/("name"\s*:\s*"(?:x-csrf-token|authorization|cookie|set-cookie)"\s*,\s*"value"\s*:\s*")(?:\\.|[^"\\])*(")/gi, `$1${redacted}$2`);
  return output;
}

function isTextFile(file, buffer) {
  if (textExtensions.has(path.extname(file).toLowerCase())) return true;
  if (buffer.includes(0)) return false;
  const sample = buffer.subarray(0, 4096).toString("utf8");
  if (sample.includes("\uFFFD")) return false;
  return [...sample].filter((character) => character === "\n" || character === "\r" || character === "\t" || character >= " ").length >= sample.length * 0.95;
}

async function filesUnder(root) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name));
}

async function rewriteZip(file, secrets) {
  const extracted = await mkdtemp(path.join(os.tmpdir(), "huddletab-trace-"));
  const replacement = `${file}.sanitized`;
  try {
    await extract(file, { dir: extracted });
    const entries = await filesUnder(extracted);
    let changed = false;
    for (const entry of entries) {
      const buffer = await readFile(entry);
      if (!isTextFile(entry, buffer)) continue;
      const current = buffer.toString("utf8");
      const sanitized = redactText(current, secrets);
      if (sanitized !== current) {
        await writeFile(entry, sanitized);
        changed = true;
      }
    }
    if (!changed) return false;

    await new Promise((resolve, reject) => {
      const zip = new yazl.ZipFile();
      zip.outputStream.pipe(createWriteStream(replacement)).on("close", resolve).on("error", reject);
      for (const entry of entries) zip.addFile(entry, path.relative(extracted, entry).replaceAll(path.sep, "/"));
      zip.end();
    });
    await rm(file);
    await rename(replacement, file);
    return true;
  } finally {
    await rm(replacement, { force: true });
    await rm(extracted, { recursive: true, force: true });
  }
}

async function rewriteZipBuffer(buffer, secrets) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "huddletab-embedded-report-"));
  const file = path.join(directory, "report.zip");
  try {
    await writeFile(file, buffer);
    const changed = await rewriteZip(file, secrets);
    return { buffer: await readFile(file), changed };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function sanitizeEmbeddedReports(input, secrets) {
  const pattern = /data:application\/zip;base64,([A-Za-z0-9+/=\r\n]+)/g;
  let output = "";
  let cursor = 0;
  let changed = false;
  for (const match of input.matchAll(pattern)) {
    output += input.slice(cursor, match.index);
    const archive = Buffer.from(match[1].replace(/\s/g, ""), "base64");
    const sanitized = await rewriteZipBuffer(archive, secrets);
    output += `data:application/zip;base64,${sanitized.buffer.toString("base64")}`;
    cursor = match.index + match[0].length;
    changed ||= sanitized.changed;
  }
  return { text: output + input.slice(cursor), changed };
}

async function sanitizeFile(file, secrets) {
  if (path.extname(file).toLowerCase() === ".zip") return rewriteZip(file, secrets);
  const buffer = await readFile(file);
  if (!isTextFile(file, buffer)) return false;
  const current = buffer.toString("utf8");
  const redactedText = redactText(current, secrets);
  const embedded = path.extname(file).toLowerCase() === ".html"
    ? await sanitizeEmbeddedReports(redactedText, secrets)
    : { text: redactedText, changed: false };
  if (embedded.text === current && !embedded.changed) return false;
  await writeFile(file, embedded.text);
  return true;
}

function sensitiveMatches(text, secrets) {
  const matches = [];
  for (const secret of secrets.filter(Boolean)) {
    if (text.includes(secret)) matches.push("exact-secret");
  }
  if (/phase1e[a-f0-9]{12}/i.test(text)) matches.push("temporary-username");
  if (/[a-f0-9]{32}(?:Aa1!|Pg1!)/i.test(text)) matches.push("temporary-password");
  if (/huddletab_(?:session|pre_auth)=(?!\[REDACTED\])[^\s;"'<]+/i.test(text)) matches.push("cookie-value");
  const header = /(?:x-csrf-token|authorization)["']?\s*[:=]\s*["']?([^\r\n"'<}]*)/gi;
  for (const match of text.matchAll(header)) {
    if (match[1].trim() && match[1].trim() !== redacted) matches.push("header-value");
  }
  if (/"name"\s*:\s*"(?:x-csrf-token|authorization|cookie|set-cookie)"\s*,\s*"value"\s*:\s*"(?!\[REDACTED\])/i.test(text)) matches.push("network-header-value");
  return matches;
}

async function inspectZip(file, secrets) {
  const extracted = await mkdtemp(path.join(os.tmpdir(), "huddletab-trace-scan-"));
  try {
    await extract(file, { dir: extracted });
    const findings = [];
    for (const entry of await filesUnder(extracted)) {
      const buffer = await readFile(entry);
      if (!isTextFile(entry, buffer)) continue;
      for (const kind of sensitiveMatches(buffer.toString("utf8"), secrets)) findings.push(`${file}!${path.relative(extracted, entry)}:${kind}`);
    }
    return findings;
  } finally {
    await rm(extracted, { recursive: true, force: true });
  }
}

async function inspectEmbeddedReports(file, text, secrets) {
  const pattern = /data:application\/zip;base64,([A-Za-z0-9+/=\r\n]+)/g;
  const findings = [];
  let index = 0;
  for (const match of text.matchAll(pattern)) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "huddletab-embedded-scan-"));
    const archive = path.join(directory, "report.zip");
    try {
      await writeFile(archive, Buffer.from(match[1].replace(/\s/g, ""), "base64"));
      for (const finding of await inspectZip(archive, secrets)) findings.push(`${file}!embedded-${index}:${finding.split(":").at(-1)}`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    index += 1;
  }
  return findings;
}

export async function sanitizeArtifacts(root, secrets) {
  if (!(await stat(root).catch(() => null))) return { filesSanitized: 0 };
  let filesSanitized = 0;
  for (const file of await filesUnder(root)) {
    if (await sanitizeFile(file, secrets)) filesSanitized += 1;
  }
  return { filesSanitized };
}

export async function scanArtifacts(root, secrets) {
  if (!(await stat(root).catch(() => null))) return [];
  const findings = [];
  for (const file of await filesUnder(root)) {
    if (path.extname(file).toLowerCase() === ".zip") {
      findings.push(...await inspectZip(file, secrets));
      continue;
    }
    const buffer = await readFile(file);
    if (!isTextFile(file, buffer)) continue;
    const text = buffer.toString("utf8");
    for (const kind of sensitiveMatches(text, secrets)) findings.push(`${file}:${kind}`);
    if (path.extname(file).toLowerCase() === ".html") findings.push(...await inspectEmbeddedReports(file, text, secrets));
  }
  return findings;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1)))) {
  const root = process.argv[2];
  if (!root) throw new Error("缺少 artifacts 目录参数。");
  const secrets = [process.env.HUDDLETAB_E2E_USERNAME, process.env.HUDDLETAB_E2E_PASSWORD, process.env.POSTGRES_PASSWORD].filter(Boolean);
  const result = await sanitizeArtifacts(root, secrets);
  const findings = await scanArtifacts(root, secrets);
  if (findings.length) throw new Error(`artifact 脱敏扫描失败：${findings.join(", ")}`);
  console.log(`artifact 脱敏验证通过：处理 ${result.filesSanitized} 个文件，敏感扫描 0 命中。`);
}
