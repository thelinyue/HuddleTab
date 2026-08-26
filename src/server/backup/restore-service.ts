import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

import * as tar from "tar";
import type postgres from "postgres";

import {
  type BackupManifest,
  type BackupRecord,
  validateBackupArchive,
} from "@/server/backup/backup-service";
import { ApplicationError } from "@/server/errors/application-error";
import { MaintenanceMode } from "@/server/maintenance/maintenance-mode";

const execFileAsync = promisify(execFile);

type MaintenanceGate = Pick<MaintenanceMode, "enter" | "leave">;
type ReadyBackup = Pick<BackupRecord, "id" | "path">;
type CommandExecutor = (
  file: string,
  args: readonly string[],
  options: { readonly windowsHide: boolean },
) => Promise<{ readonly stdout?: string }>;

export type RestoreServiceOptions = {
  readonly requireReady: (backupId: string) => Promise<ReadyBackup>;
  readonly validate: (path: string) => Promise<BackupManifest>;
  readonly assertCompatible: (manifest: BackupManifest) => Promise<void>;
  readonly maintenance: MaintenanceGate;
  readonly restoreDatabase: (archivePath: string) => Promise<void>;
  readonly replaceUploads: (archivePath: string) => Promise<void>;
  readonly runMigrations: () => Promise<void>;
  readonly runSmokeCheck: () => Promise<void>;
};

/**
 * 恢复流程是串行高风险事务边界：归档和兼容性必须在进入维护模式前失败，进入后只有数据库、
 * 上传文件、迁移和 Smoke 全部成功才能退出。任一步失败都刻意保持维护模式，防止半恢复数据继续写入。
 */
export class RestoreService {
  constructor(private readonly options: RestoreServiceOptions) {}

  async restore(backupId: string, actorUserId: string): Promise<void> {
    const record = await this.options.requireReady(backupId);
    const manifest = await this.options.validate(record.path);
    await this.options.assertCompatible(manifest);
    await this.options.maintenance.enter("RESTORE", actorUserId);
    try {
      await this.options.restoreDatabase(record.path);
      await this.options.replaceUploads(record.path);
      await this.options.runMigrations();
      await this.options.runSmokeCheck();
      await this.options.maintenance.leave();
    } catch {
      console.error(
        "恢复失败，系统仍处于维护模式 [RESTORE_FAILED]，请检查数据库、备份文件和部署日志。",
      );
      throw new ApplicationError(
        "RESTORE_FAILED",
        "恢复失败，系统保持维护模式，请管理员查看部署日志并修复后重试。",
        500,
      );
    }
  }
}

/** 构造生产恢复服务；Route 只负责管理员授权，所有归档与路径边界留在此模块。 */
export function createDatabaseRestoreService(
  sql: ReturnType<typeof postgres>,
): RestoreService {
  const dataRoot = resolve(
    /* turbopackIgnore: true */ process.env.DATA_DIR ??
      join(process.cwd(), "data"),
  );
  const backupsRoot = join(dataRoot, "backups");
  return new RestoreService({
    requireReady: async (backupId) => {
      const [record] = await sql<
        { readonly id: string; readonly storage_path: string }[]
      >`select id, storage_path from backup_records where id = ${backupId} and status = 'READY'`;
      if (!record)
        throw new ApplicationError(
          "BACKUP_NOT_FOUND",
          "备份不存在或尚未可用。",
          404,
        );
      assertUnderRoot(backupsRoot, record.storage_path);
      return { id: record.id, path: record.storage_path };
    },
    validate: async (archivePath) => {
      await validateBackupArchive(archivePath);
      return readManifest(archivePath, backupsRoot);
    },
    assertCompatible: async (manifest) => {
      if (manifest.formatVersion !== 1)
        throw new ApplicationError(
          "BACKUP_INCOMPATIBLE",
          "该备份格式与当前版本不兼容，无法恢复。",
          422,
        );
    },
    maintenance: new MaintenanceMode(sql),
    restoreDatabase: (archivePath) =>
      restoreDatabaseArchive(archivePath, backupsRoot),
    replaceUploads: (archivePath) =>
      replaceUploadsArchive(archivePath, backupsRoot, dataRoot),
    runMigrations: runMigrations,
    runSmokeCheck: async () => {
      await sql`select 1 as healthy`;
    },
  });
}

async function readManifest(
  archivePath: string,
  backupsRoot: string,
): Promise<BackupManifest> {
  const work = await extractArchive(archivePath, backupsRoot);
  try {
    const raw = await import("node:fs/promises").then(({ readFile }) =>
      readFile(join(work, "manifest.json"), "utf8"),
    );
    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== "object" ||
      value === null ||
      !("formatVersion" in value) ||
      typeof value.formatVersion !== "number" ||
      !("appVersion" in value) ||
      typeof value.appVersion !== "string"
    )
      throw new ApplicationError(
        "BACKUP_ARCHIVE_INVALID",
        "备份 manifest 格式无效。",
        422,
      );
    return value as BackupManifest;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function restoreDatabaseArchive(
  archivePath: string,
  backupsRoot: string,
): Promise<void> {
  const work = await extractArchive(archivePath, backupsRoot);
  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("未配置 DATABASE_URL，无法恢复数据库。");
    await restoreDatabaseDump(join(work, "database.dump"), databaseUrl);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/**
 * maintenance_state 是恢复期间跨实例共享的数据库维护闸门，不能被归档中的 false 覆盖。
 * pg_restore 没有 --exclude-table 参数，故先生成 TOC 清单，再移除该表的 schema、数据及
 * 约束项。恢复全过程不触碰该单例，其余数据库对象仍按完整 Dump 恢复。
 */
export async function restoreDatabaseDump(
  dumpPath: string,
  databaseUrl: string,
  execute: CommandExecutor = execFileAsync,
): Promise<void> {
  const list = await execute("pg_restore", ["--list", dumpPath], {
    windowsHide: true,
  });
  if (typeof list.stdout !== "string")
    throw new Error("无法读取数据库备份目录，恢复已中止。");

  const listDirectory = await mkdtemp(join(dirname(dumpPath), ".restore-toc-"));
  const listPath = join(listDirectory, "restore.list");
  try {
    await writeFile(
      listPath,
      excludeMaintenanceStateFromRestoreList(list.stdout),
    );
    await execute(
      "pg_restore",
      [
        "--clean",
        "--if-exists",
        "--no-owner",
        "--use-list",
        listPath,
        "--dbname",
        databaseUrl,
        dumpPath,
      ],
      { windowsHide: true },
    );
  } finally {
    await rm(listDirectory, { recursive: true, force: true });
  }
}

/** 仅过滤运行态维护单例，完整恢复仍应覆盖所有用户可配置的 system_settings。 */
export function excludeMaintenanceStateFromRestoreList(list: string): string {
  return list
    .split(/\r?\n/)
    .filter((line) => !/\bmaintenance_state\b/.test(line))
    .join("\n");
}

async function replaceUploadsArchive(
  archivePath: string,
  backupsRoot: string,
  dataRoot: string,
): Promise<void> {
  const work = await extractArchive(archivePath, backupsRoot);
  const uploadsRoot = join(dataRoot, "uploads");
  const stagedUploads = join(work, "uploads");
  const previousUploads = join(
    dataRoot,
    `.uploads-before-restore-${Date.now()}`,
  );
  let movedCurrent = false;
  try {
    await mkdir(dataRoot, { recursive: true });
    try {
      const current = await lstat(uploadsRoot);
      if (current.isSymbolicLink())
        throw new Error("Uploads 根目录不能是符号链接。");
      await rename(uploadsRoot, previousUploads);
      movedCurrent = true;
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    await rename(stagedUploads, uploadsRoot);
    if (movedCurrent)
      await rm(previousUploads, { recursive: true, force: true });
  } catch (error) {
    if (movedCurrent) {
      await rm(uploadsRoot, { recursive: true, force: true }).catch(
        () => undefined,
      );
      await rename(previousUploads, uploadsRoot).catch(() => undefined);
    }
    throw error;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function extractArchive(
  archivePath: string,
  backupsRoot: string,
): Promise<string> {
  assertUnderRoot(backupsRoot, archivePath);
  await validateBackupArchive(archivePath);
  const work = await mkdtemp(join(backupsRoot, ".restore-"));
  try {
    await tar.extract({
      file: archivePath,
      cwd: work,
      strict: true,
      preservePaths: false,
      noMtime: true,
      filter(path, entry) {
        const safe =
          path === "manifest.json" ||
          path === "database.dump" ||
          path === "uploads" ||
          path.startsWith("uploads/");
        return (
          safe &&
          (!("type" in entry) ||
            (entry.type !== "SymbolicLink" && entry.type !== "Link"))
        );
      },
    });
    return work;
  } catch (error) {
    await rm(work, { recursive: true, force: true });
    throw error;
  }
}

async function runMigrations(): Promise<void> {
  await execFileAsync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "src/server/db/migrate.ts"],
    {
      cwd: process.cwd(),
      windowsHide: true,
    },
  );
}

function assertUnderRoot(root: string, candidate: string): void {
  const rootPath = resolve(root);
  const candidatePath = resolve(candidate);
  const rel = relative(rootPath, candidatePath);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new ApplicationError("BACKUP_PATH_INVALID", "备份路径无效。", 422);
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
