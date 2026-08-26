import { createHash, randomUUID } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

import * as tar from "tar";
import type postgres from "postgres";

import { ApplicationError } from "@/server/errors/application-error";

const execFileAsync = promisify(execFile);
const archiveRoots = new Set(["manifest.json", "database.dump", "uploads"]);

export type BackupManifest = {
  readonly formatVersion: number;
  readonly appVersion: string;
  readonly createdAt?: string;
};

export type BackupRecord = {
  readonly id: string;
  readonly path: string;
  readonly filename: string;
  readonly sizeBytes: bigint;
  readonly checksum: string;
  readonly createdByUserId: string;
  readonly createdAt?: Date;
  readonly status?: "READY" | "RESTORING" | "FAILED";
};

type ReadyBackupInput = Omit<BackupRecord, "id" | "createdAt" | "status">;

export type BackupServiceOptions = {
  readonly backupsRoot?: string;
  readonly uploadsRoot?: string;
  readonly createDatabaseDump?: (destination: string) => Promise<void>;
  readonly createManifest?: () => Promise<BackupManifest>;
  readonly recordReady?: (input: ReadyBackupInput) => Promise<BackupRecord>;
};

type ArchiveEntry = {
  readonly path: string;
  readonly type?: string;
};

type ArchiveValidationInput =
  | string
  | {
      readonly archive?: string;
      readonly source?: string;
      readonly entries?: readonly (string | ArchiveEntry)[];
    };

/**
 * 完整备份的归档白名单只有 manifest.json、database.dump 和 uploads。验证在任何解包前运行，
 * 因此绝对路径、遍历、链接和 Backups 自包含都不能触碰宿主机文件系统。
 */
export async function validateBackupArchive(
  input: ArchiveValidationInput,
): Promise<string[]> {
  const options = typeof input === "string" ? { archive: input } : input;
  if (options.source) await assertSourceTreeSafe(options.source);

  const entries: ArchiveEntry[] = (options.entries ?? []).map((entry) =>
    typeof entry === "string" ? { path: entry } : entry,
  );
  if (options.archive) {
    await tar.list({
      file: options.archive,
      onReadEntry(entry) {
        assertSafeEntry(entry.path, entry.type);
        entries.push({ path: entry.path, type: entry.type });
      },
    });
  }
  if (!entries.length) throw invalidArchive("备份归档为空或无法读取。");

  const normalized = entries.map((entry) => {
    assertSafeEntry(entry.path, entry.type);
    return { ...entry, path: normalizeArchiveEntry(entry.path) };
  });
  if (
    !normalized.some((entry) => entry.path === "manifest.json") ||
    !normalized.some((entry) => entry.path === "database.dump") ||
    !normalized.some((entry) => entry.path === "uploads")
  )
    throw invalidArchive(
      "备份归档缺少 manifest.json、database.dump 或 uploads 目录。",
    );
  return normalized
    .filter((entry) => entry.path !== "uploads" && entry.type !== "Directory")
    .map((entry) => entry.path)
    .sort((left, right) => left.localeCompare(right));
}

/** 备份服务只接触 DATA_DIR 下的 uploads/backups；从不把 backups 作为归档源目录。 */
export class BackupService {
  private readonly backupsRoot: string;
  private readonly uploadsRoot: string;
  private readonly createDatabaseDump: (destination: string) => Promise<void>;
  private readonly createManifest: () => Promise<BackupManifest>;
  private readonly recordReady: (
    input: ReadyBackupInput,
  ) => Promise<BackupRecord>;
  private createTail: Promise<void> = Promise.resolve();

  constructor(options: BackupServiceOptions = {}) {
    const dataRoot = resolve(
      /* turbopackIgnore: true */ process.env.DATA_DIR ??
        join(process.cwd(), "data"),
    );
    this.backupsRoot = resolve(
      /* turbopackIgnore: true */ options.backupsRoot ??
        join(dataRoot, "backups"),
    );
    this.uploadsRoot = resolve(
      /* turbopackIgnore: true */ options.uploadsRoot ??
        join(dataRoot, "uploads"),
    );
    this.createDatabaseDump = options.createDatabaseDump ?? createDatabaseDump;
    this.createManifest =
      options.createManifest ??
      (async () => ({
        formatVersion: 1,
        appVersion: process.env.APP_VERSION ?? "dev",
        createdAt: new Date().toISOString(),
      }));
    this.recordReady = options.recordReady ?? recordReadyFromDatabase;
  }

  async create(actorUserId: string): Promise<BackupRecord> {
    const previous = this.createTail;
    let release!: () => void;
    this.createTail = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    await previous;
    try {
      return await this.createExclusive(actorUserId);
    } finally {
      release();
    }
  }

  private async createExclusive(actorUserId: string): Promise<BackupRecord> {
    await mkdir(this.backupsRoot, { recursive: true });
    const work = await mkdtemp(join(this.backupsRoot, ".create-"));
    try {
      const dumpPath = join(work, "database.dump");
      await this.createDatabaseDump(dumpPath);
      await copyRegularTree(this.uploadsRoot, join(work, "uploads"));
      await writeFile(
        join(work, "manifest.json"),
        `${JSON.stringify(await this.createManifest())}\n`,
        "utf8",
      );

      const filename = `backup_${Date.now()}_${randomUUID()}.tar.gz`;
      const path = join(this.backupsRoot, filename);
      await tar.create(
        { cwd: work, file: path, gzip: true, portable: true, noMtime: true },
        ["manifest.json", "database.dump", "uploads"],
      );
      await validateBackupArchive(path);
      const metadata = await stat(path);
      return await this.recordReady({
        path,
        filename,
        sizeBytes: BigInt(metadata.size),
        checksum: await sha256File(path),
        createdByUserId: actorUserId,
      });
    } catch (error) {
      console.error(
        "备份创建失败 [BACKUP_CREATE_FAILED]，请检查数据库连接、磁盘空间和数据目录权限。",
      );
      throw error;
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }
}

/** 供管理 Route 使用的持久化适配器，记录字段不含归档字节。 */
export function createDatabaseBackupService(
  sql: ReturnType<typeof postgres>,
): BackupService {
  return new BackupService({
    recordReady: async (input) => {
      const id = randomUUID();
      const [record] = await sql<
        {
          readonly id: string;
          readonly storage_path: string;
          readonly filename: string;
          readonly size_bytes: bigint;
          readonly checksum: string;
          readonly created_by_user_id: string;
          readonly created_at: Date;
          readonly status: "READY";
        }[]
      >`insert into backup_records (id, status, storage_path, filename, size_bytes, checksum, created_by_user_id, created_at, updated_at)
        values (${id}, 'READY', ${input.path}, ${input.filename}, ${input.sizeBytes.toString()}, ${input.checksum}, ${input.createdByUserId}, now(), now())
        returning id, storage_path, filename, size_bytes, checksum, created_by_user_id, created_at, status`;
      return {
        id: record!.id,
        path: record!.storage_path,
        filename: record!.filename,
        sizeBytes: record!.size_bytes,
        checksum: record!.checksum,
        createdByUserId: record!.created_by_user_id,
        createdAt: record!.created_at,
        status: record!.status,
      };
    },
  });
}

/** 管理列表只返回元数据；内部 storagePath 永远不跨越 Service/API 边界。 */
export async function listBackups(
  sql: ReturnType<typeof postgres>,
): Promise<BackupRecord[]> {
  const records = await sql<
    {
      readonly id: string;
      readonly status: "READY" | "RESTORING" | "FAILED";
      readonly storage_path: string;
      readonly filename: string;
      readonly size_bytes: bigint;
      readonly checksum: string;
      readonly created_by_user_id: string;
      readonly created_at: Date;
    }[]
  >`select id, status, storage_path, filename, size_bytes, checksum, created_by_user_id, created_at
    from backup_records order by created_at desc, id desc`;
  return records.map((record) => ({
    id: record.id,
    status: record.status,
    path: record.storage_path,
    filename: record.filename,
    sizeBytes: record.size_bytes,
    checksum: record.checksum,
    createdByUserId: record.created_by_user_id,
    createdAt: record.created_at,
  }));
}

/** 下载与删除共享同一条路径校验，避免 DB 元数据被异常改写时越过 backups 边界。 */
export async function requireBackupFile(
  sql: ReturnType<typeof postgres>,
  backupId: string,
): Promise<Pick<BackupRecord, "id" | "path" | "filename" | "sizeBytes">> {
  const [record] = await sql<
    {
      readonly id: string;
      readonly storage_path: string;
      readonly filename: string;
      readonly size_bytes: bigint;
    }[]
  >`select id, storage_path, filename, size_bytes from backup_records
    where id = ${backupId} and status = 'READY'`;
  if (!record)
    throw new ApplicationError(
      "BACKUP_NOT_FOUND",
      "备份不存在或尚未可用。",
      404,
    );
  assertBackupPath(record.storage_path);
  if (!/^backup_\d+_[0-9a-f-]+\.tar\.gz$/i.test(record.filename))
    throw new ApplicationError("BACKUP_PATH_INVALID", "备份文件名无效。", 422);
  const metadata = await lstat(record.storage_path).catch((error: unknown) => {
    if (isMissing(error))
      throw new ApplicationError(
        "BACKUP_NOT_FOUND",
        "备份文件不存在，请重新创建备份。",
        404,
      );
    throw error;
  });
  if (metadata.isSymbolicLink() || !metadata.isFile())
    throw new ApplicationError(
      "BACKUP_PATH_INVALID",
      "备份文件路径无效。",
      422,
    );
  return {
    id: record.id,
    path: record.storage_path,
    filename: record.filename,
    sizeBytes: record.size_bytes,
  };
}

export async function deleteBackup(
  sql: ReturnType<typeof postgres>,
  backupId: string,
): Promise<void> {
  const record = await requireBackupFile(sql, backupId);
  await rm(record.path);
  await sql`delete from backup_records where id = ${record.id}`;
}

export function backupsRoot(): string {
  return resolve(
    /* turbopackIgnore: true */ process.env.DATA_DIR ??
      join(process.cwd(), "data"),
    "backups",
  );
}

export function assertBackupPath(path: string): void {
  const root = backupsRoot();
  const candidate = resolve(path);
  const rel = relative(root, candidate);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new ApplicationError("BACKUP_PATH_INVALID", "备份路径无效。", 422);
}

async function recordReadyFromDatabase(
  input: ReadyBackupInput,
): Promise<BackupRecord> {
  void input;
  throw new Error(
    "创建持久化备份时必须使用 createDatabaseBackupService(sql)。",
  );
}

async function createDatabaseDump(destination: string): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl)
    throw new Error("未配置 DATABASE_URL，无法创建数据库备份。");
  await execFileAsync(
    "pg_dump",
    ["--format=custom", "--file", destination, databaseUrl],
    {
      windowsHide: true,
    },
  );
}

async function copyRegularTree(
  source: string,
  destination: string,
): Promise<void> {
  let metadata;
  try {
    metadata = await lstat(source);
  } catch (error) {
    if (isMissing(error)) {
      await mkdir(destination, { recursive: true });
      return;
    }
    throw error;
  }
  if (metadata.isSymbolicLink()) return;
  if (!metadata.isDirectory())
    throw new Error("Uploads 数据目录不是可读取目录。");
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    const child = await lstat(from);
    if (child.isSymbolicLink()) continue;
    if (child.isDirectory()) await copyRegularTree(from, to);
    if (child.isFile())
      await cp(from, to, { force: false, errorOnExist: false });
  }
}

async function assertSourceTreeSafe(root: string): Promise<void> {
  let metadata;
  try {
    metadata = await lstat(root);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  if (metadata.isSymbolicLink())
    throw invalidArchive("归档源目录不能是符号链接。");
  if (!metadata.isDirectory()) throw invalidArchive("归档源路径不是目录。");
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const child = join(root, entry.name);
    const childMetadata = await lstat(child);
    if (childMetadata.isSymbolicLink())
      throw invalidArchive("归档不允许包含符号链接。");
    if (childMetadata.isDirectory()) await assertSourceTreeSafe(child);
  }
}

function assertSafeEntry(entry: string, type?: string): void {
  const normalized = normalizeArchiveEntry(entry);
  if (
    !normalized ||
    isAbsolute(entry) ||
    entry.includes("\\") ||
    entry.split("/").some((part) => part === "..") ||
    type === "SymbolicLink" ||
    type === "Link"
  )
    throw invalidArchive("备份归档包含不安全路径或链接。");
  const [root] = normalized.split("/");
  if (!root || !archiveRoots.has(root))
    throw invalidArchive("备份归档包含未允许的文件。");
  if (
    (root === "manifest.json" || root === "database.dump") &&
    normalized !== root
  )
    throw invalidArchive("备份归档包含不合法的顶层文件路径。");
}

function normalizeArchiveEntry(entry: string): string {
  return entry.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function invalidArchive(message: string): ApplicationError {
  return new ApplicationError("BACKUP_ARCHIVE_INVALID", message, 422);
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function sha256File(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}
