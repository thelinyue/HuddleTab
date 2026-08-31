import { readdir, rm, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import type postgres from "postgres";

type CleanupLogger = Pick<Console, "info">;

type OrphanAttachmentCleanupOptions = {
  readonly uploadsRoot?: string;
  readonly now?: () => Date;
  readonly logger?: CleanupLogger;
  readonly removeFile?: (path: string) => Promise<void>;
};

type CleanupResult = {
  readonly scanned: number;
  readonly deleted: number;
  readonly skipped: boolean;
};

const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

type StartedCleanup = Pick<OrphanAttachmentCleanup, "run">;
type ScheduleOptions = {
  readonly createCleanup?: () => StartedCleanup;
  readonly setInterval?: (
    callback: () => void,
    delay: number,
  ) => { unref?: () => void };
  readonly logger?: Pick<Console, "error">;
};

/**
 * 孤立附件只可能产生于“文件已写入、元数据事务尚未提交”时进程异常中断的窗口。
 * 清理器始终以数据库元数据为准，避免把尚未写入元数据的附件误判为有效文件。
 */
export class OrphanAttachmentCleanup {
  private readonly uploadsRoot: string;
  private readonly now: () => Date;
  private readonly logger: CleanupLogger;
  private readonly removeFile: (path: string) => Promise<void>;

  constructor(
    private readonly sql: ReturnType<typeof postgres>,
    options: OrphanAttachmentCleanupOptions = {},
  ) {
    this.uploadsRoot = resolve(
      options.uploadsRoot ??
        join(process.env.DATA_DIR ?? join(process.cwd(), "data"), "uploads"),
    );
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? console;
    this.removeFile = options.removeFile ?? ((path) => rm(path));
  }

  async run(): Promise<CleanupResult> {
    const files = await this.listFiles(this.uploadsRoot);
    const threshold = this.now().getTime() - ORPHAN_AGE_MS;
    let deleted = 0;

    for (const file of files) {
      if (file.modifiedAt.getTime() >= threshold) continue;

      const [metadata] = await this.sql<{ exists: boolean }[]>`
        select exists(
          select 1 from expense_attachments where storage_key = ${file.storageKey}
        ) as exists
      `;
      if (metadata?.exists) continue;

      await this.removeFile(file.path);
      deleted += 1;
    }

    this.logger.info(
      `孤立附件清理完成：扫描 ${files.length} 个文件，删除 ${deleted} 个文件。`,
    );
    return { scanned: files.length, deleted, skipped: false };
  }

  private async listFiles(directory: string): Promise<StoredFile[]> {
    let entries: Dirent<string>[];
    try {
      entries = await readdir(directory, {
        encoding: "utf8",
        withFileTypes: true,
      });
    } catch (error) {
      if (isMissingDirectory(error)) return [];
      throw error;
    }

    const files: StoredFile[] = [];
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await this.listFiles(path)));
        continue;
      }
      if (!entry.isFile()) continue;

      files.push({
        path,
        storageKey: relative(this.uploadsRoot, path).split(sep).join("/"),
        modifiedAt: (await stat(path)).mtime,
      });
    }
    return files;
  }
}

/**
 * 容器进程中的单实例回收任务。任何清理失败只写中文部署日志，不能终止正在运行的 Web 应用。
 */
export function startOrphanAttachmentCleanup(
  sql: ReturnType<typeof postgres>,
  options: ScheduleOptions = {},
) {
  const cleanup = options.createCleanup?.() ?? new OrphanAttachmentCleanup(sql);
  const logger = options.logger ?? console;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await cleanup.run();
    } catch {
      logger.error("孤立附件清理失败，请检查数据库和存储配置。");
    } finally {
      running = false;
    }
  };
  void run();
  const timer = (options.setInterval ?? setInterval)(
    () => void run(),
    CLEANUP_INTERVAL_MS,
  );
  if (typeof timer !== "number") timer.unref?.();
  return () => clearInterval(timer as ReturnType<typeof setInterval>);
}

type StoredFile = {
  readonly path: string;
  readonly storageKey: string;
  readonly modifiedAt: Date;
};

function isMissingDirectory(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
