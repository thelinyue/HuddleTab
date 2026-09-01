import { createWriteStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extract, yazl } from "playwright-core/lib/zipBundle";

const redacted = "[REDACTED]";
const maxZipDepth = 5;
const textExtensions = new Set([".css", ".html", ".json", ".jsonl", ".js", ".log", ".md", ".network", ".stacks", ".trace", ".txt", ".xml"]);
const sessionCookieNames = new Set(["huddletab_session", "huddletab_pre_auth"]);
const sensitiveHeaderNames = new Set(["authorization", "cookie", "set-cookie", "x-csrf-token"]);

function visitStructuredCredentials(value, visitor) {
  if (Array.isArray(value)) {
    for (const item of value) visitStructuredCredentials(item, visitor);
    return;
  }
  if (!value || typeof value !== "object") return;

  const name = typeof value.name === "string" ? value.name.toLowerCase() : "";
  if (Object.hasOwn(value, "value") && sessionCookieNames.has(name)) visitor(value, "value", "session-cookie");
  if (Object.hasOwn(value, "value") && sensitiveHeaderNames.has(name)) visitor(value, "value", "network-header-value");
  for (const [key, child] of Object.entries(value)) {
    if (key.toLowerCase() === "token") visitor(value, key, "csrf-token");
    else visitStructuredCredentials(child, visitor);
  }
}

function redactStructuredJson(input) {
  let value;
  try {
    value = JSON.parse(input);
  } catch {
    return input;
  }
  let changed = false;
  visitStructuredCredentials(value, (owner, key) => {
    if (owner[key] !== redacted && owner[key] !== null && owner[key] !== "") {
      owner[key] = redacted;
      changed = true;
    }
  });
  return changed ? JSON.stringify(value) : input;
}

function redactText(input, secrets) {
  let output = redactStructuredJson(input);
  for (const secret of secrets.filter(Boolean)) output = output.replaceAll(secret, redacted);
  output = output
    .replace(/(huddletab_(?:session|pre_auth)=)(?!\[REDACTED\])[^\s;"'<]+/gi, `$1${redacted}`)
    .replace(/((?:x-csrf-token|authorization|cookie|set-cookie)["']?\s*[:=]\s*["']?)(?!\[REDACTED\])[^\r\n"'<}]*/gi, `$1${redacted}`)
    .replace(/("name"\s*:\s*"(?:x-csrf-token|authorization|cookie|set-cookie|huddletab_session|huddletab_pre_auth)"\s*,\s*"value"\s*:\s*")(?:\\.|[^"\\])*(")/gi, `$1${redacted}$2`)
    .replace(/("token"\s*:\s*")(?:\\.|[^"\\])*(")/gi, `$1${redacted}$2`);
  return output;
}

function isTextFile(file, buffer) {
  if (textExtensions.has(path.extname(file).toLowerCase())) return true;
  if (buffer.includes(0)) return false;
  const sample = buffer.subarray(0, 4096).toString("utf8");
  if (sample.includes("\uFFFD")) return false;
  return [...sample].filter((character) => character === "\n" || character === "\r" || character === "\t" || character >= " ").length >= sample.length * 0.95;
}

function isZipBuffer(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) return false;
  return (buffer[2] === 0x03 && buffer[3] === 0x04)
    || (buffer[2] === 0x05 && buffer[3] === 0x06)
    || (buffer[2] === 0x07 && buffer[3] === 0x08);
}

function assertZipDepth(depth) {
  if (depth > maxZipDepth) throw new Error(`artifact ZIP 嵌套超过安全扫描上限 ${maxZipDepth} 层。`);
}

async function filesUnder(root) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name));
}

export async function replaceArtifactFile(file, replacement, operations = {}) {
  const renameFile = operations.rename ?? rename;
  const removeFile = operations.rm ?? rm;
  const backup = `${file}.backup-${randomUUID()}`;
  await renameFile(file, backup);
  try {
    await renameFile(replacement, file);
  } catch (replacementError) {
    try {
      await renameFile(backup, file);
    } catch (rollbackError) {
      const error = new Error(`artifact 替换失败且原文件回滚失败；可恢复备份保留在 ${backup}。替换错误：${replacementError.message}；回滚错误：${rollbackError.message}`, { cause: replacementError });
      error.rollbackError = rollbackError;
      throw error;
    }
    throw replacementError;
  }
  try {
    await removeFile(backup, { force: true });
  } catch (error) {
    throw new Error(`artifact 已完成替换，但敏感原文件备份删除失败：${backup}`, { cause: error });
  }
}

function sensitiveMatches(text, secrets) {
  const matches = new Set();
  for (const secret of secrets.filter(Boolean)) {
    if (text.includes(secret)) matches.add("exact-secret");
  }
  if (/phase1e[a-f0-9]{12}/i.test(text)) matches.add("temporary-username");
  if (/[a-f0-9]{32}(?:Aa1!|Pg1!)/i.test(text)) matches.add("temporary-password");
  if (/huddletab_(?:session|pre_auth)=(?!\[REDACTED\])[^\s;"'<]+/i.test(text)) matches.add("cookie-value");
  const header = /(?:x-csrf-token|authorization)["']?\s*[:=]\s*["']?([^\r\n"'<}]*)/gi;
  for (const match of text.matchAll(header)) {
    if (match[1].trim() && match[1].trim() !== redacted) matches.add("header-value");
  }
  if (/"name"\s*:\s*"(?:x-csrf-token|authorization|cookie|set-cookie)"\s*,\s*"value"\s*:\s*"(?!\[REDACTED\])/i.test(text)) matches.add("network-header-value");
  if (/"name"\s*:\s*"huddletab_(?:session|pre_auth)"\s*,\s*"value"\s*:\s*"(?!\[REDACTED\])/i.test(text)) matches.add("session-cookie");
  if (/"token"\s*:\s*"(?!\[REDACTED\])[^"\r\n]+"/i.test(text)) matches.add("csrf-token");
  try {
    const value = JSON.parse(text);
    visitStructuredCredentials(value, (owner, key, kind) => {
      if (owner[key] !== redacted && owner[key] !== null && owner[key] !== "") matches.add(kind);
    });
  } catch {
    // trace 与 network 可能是 NDJSON；上面的模式继续覆盖逐行结构化字段。
  }
  return [...matches];
}

function sensitiveBufferMatches(buffer, secrets) {
  const encoding = isTextFile("artifact.bin", buffer) ? "utf8" : "latin1";
  const matches = new Set(sensitiveMatches(buffer.toString(encoding), secrets));
  for (const secret of secrets.filter(Boolean)) {
    if (buffer.includes(Buffer.from(secret))) matches.add("exact-secret");
  }
  return [...matches];
}

async function rewriteZip(file, secrets, depth = 0) {
  assertZipDepth(depth);
  const extracted = await mkdtemp(path.join(os.tmpdir(), "huddletab-trace-"));
  const replacement = `${file}.sanitized-${randomUUID()}`;
  try {
    await extract(file, { dir: extracted });
    const entries = await filesUnder(extracted);
    let changed = false;
    for (const entry of entries) {
      const buffer = await readFile(entry);
      if (isZipBuffer(buffer)) {
        const nestedChanged = await rewriteZip(entry, secrets, depth + 1);
        changed ||= nestedChanged;
      } else if (isTextFile(entry, buffer)) {
        const current = buffer.toString("utf8");
        const sanitized = redactText(current, secrets);
        if (sanitized !== current) {
          await writeFile(entry, sanitized);
          changed = true;
        }
      } else if (sensitiveBufferMatches(buffer, secrets).length) {
        await writeFile(entry, redacted);
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
    await replaceArtifactFile(file, replacement);
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
  const buffer = await readFile(file);
  if (path.extname(file).toLowerCase() === ".zip" || isZipBuffer(buffer)) return rewriteZip(file, secrets);
  if (!isTextFile(file, buffer)) {
    if (!sensitiveBufferMatches(buffer, secrets).length) return false;
    await writeFile(file, redacted);
    return true;
  }
  const current = buffer.toString("utf8");
  const redactedText = redactText(current, secrets);
  const embedded = path.extname(file).toLowerCase() === ".html"
    ? await sanitizeEmbeddedReports(redactedText, secrets)
    : { text: redactedText, changed: false };
  if (embedded.text === current && !embedded.changed) return false;
  await writeFile(file, embedded.text);
  return true;
}

async function inspectZip(file, secrets, displayPath = file, depth = 0) {
  assertZipDepth(depth);
  const extracted = await mkdtemp(path.join(os.tmpdir(), "huddletab-trace-scan-"));
  try {
    await extract(file, { dir: extracted });
    const findings = [];
    for (const entry of await filesUnder(extracted)) {
      const buffer = await readFile(entry);
      const relative = path.relative(extracted, entry).replaceAll(path.sep, "/");
      if (isZipBuffer(buffer)) findings.push(...await inspectZip(entry, secrets, `${displayPath}!${relative}`, depth + 1));
      else for (const kind of sensitiveBufferMatches(buffer, secrets)) findings.push(`${displayPath}!${relative}:${kind}`);
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
    const buffer = await readFile(file);
    if (path.extname(file).toLowerCase() === ".zip" || isZipBuffer(buffer)) {
      findings.push(...await inspectZip(file, secrets));
      continue;
    }
    for (const kind of sensitiveBufferMatches(buffer, secrets)) findings.push(`${file}:${kind}`);
    if (path.extname(file).toLowerCase() === ".html") findings.push(...await inspectEmbeddedReports(file, buffer.toString("utf8"), secrets));
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
