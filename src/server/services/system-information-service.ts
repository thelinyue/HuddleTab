import { lstat, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import type postgres from "postgres";

export type StorageDirectory = "uploads" | "backups";

export interface SystemInformationProbe {
  databaseBytes(): Promise<bigint>;
  databaseVersion(): Promise<string>;
  directoryBytes(name: StorageDirectory): Promise<bigint>;
}

interface SystemInformationOptions {
  readonly appVersion?: string;
  readonly pwaVersion?: string;
  readonly dataDirectory?: string;
}

const storageDirectories = new Set<StorageDirectory>(["uploads", "backups"]);

function defaultDataDirectory() {
  return resolve(
    /* turbopackIgnore: true */ process.env.DATA_DIR ??
      join(process.cwd(), "data"),
  );
}

/**
 * 只读系统探针把 PostgreSQL 与本地持久目录的查询收拢到一起。目录名称是封闭枚举，
 * 且每个节点先 lstat 再决定是否递归，符号链接永远不跟随，避免统计越过 DATA_DIR。
 */
export class SystemProbe implements SystemInformationProbe {
  constructor(
    private readonly sql: ReturnType<typeof postgres>,
    private readonly dataDirectory = defaultDataDirectory(),
  ) {}

  async databaseBytes(): Promise<bigint> {
    const [result] = await this.sql<{ readonly bytes: string }[]>`
      select pg_database_size(current_database())::text as bytes`;
    if (!result?.bytes) throw new Error("无法获取当前数据库大小。");
    return BigInt(result.bytes);
  }

  async databaseVersion(): Promise<string> {
    const [result] = await this.sql<
      { readonly version: string }[]
    >`select version()`;
    if (!result?.version) throw new Error("无法获取数据库版本信息。");
    return result.version;
  }

  async directoryBytes(name: StorageDirectory): Promise<bigint> {
    if (!storageDirectories.has(name)) {
      throw new Error("仅允许统计 uploads 或 backups 目录。");
    }
    return directoryBytes(join(this.dataDirectory, name));
  }
}

async function directoryBytes(directory: string): Promise<bigint> {
  let directoryMetadata: Awaited<ReturnType<typeof lstat>>;
  try {
    directoryMetadata = await lstat(directory);
  } catch (error) {
    if (isMissingPath(error)) return 0n;
    throw error;
  }
  if (directoryMetadata.isSymbolicLink() || !directoryMetadata.isDirectory())
    return 0n;

  let entries;
  try {
    entries = await readdir(directory, {
      withFileTypes: true,
      encoding: "utf8",
    });
  } catch (error) {
    if (isMissingPath(error)) return 0n;
    throw error;
  }

  let total = 0n;
  for (const entry of entries) {
    const path = join(directory, entry.name);
    let metadata: Awaited<ReturnType<typeof lstat>>;
    try {
      metadata = await lstat(path);
    } catch (error) {
      if (isMissingPath(error)) continue;
      throw error;
    }
    if (metadata.isSymbolicLink()) continue;
    if (metadata.isFile()) total += BigInt(metadata.size);
    if (metadata.isDirectory()) total += await directoryBytes(path);
  }
  return total;
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/**
 * 返回值先转换为十进制字符串再穿过 API 边界；前端不得把存储字节数降级为 Number，
 * 以免大于 2^53 时静默失真。绝对 dataDirectory 只能从管理员 Route 取得。
 */
export class SystemInformationService {
  private readonly options: Required<SystemInformationOptions>;

  constructor(
    private readonly probe: SystemInformationProbe,
    options: SystemInformationOptions = {},
  ) {
    this.options = {
      appVersion: options.appVersion ?? process.env.APP_VERSION ?? "dev",
      pwaVersion: options.pwaVersion ?? process.env.PWA_VERSION ?? "dev",
      dataDirectory: options.dataDirectory ?? defaultDataDirectory(),
    };
  }

  async storage() {
    const [databaseBytes, uploadsBytes, backupsBytes] = await Promise.all([
      this.probe.databaseBytes(),
      this.probe.directoryBytes("uploads"),
      this.probe.directoryBytes("backups"),
    ]);
    return {
      databaseBytes: databaseBytes.toString(),
      uploadsBytes: uploadsBytes.toString(),
      backupsBytes: backupsBytes.toString(),
      totalBytes: (databaseBytes + uploadsBytes + backupsBytes).toString(),
    };
  }

  async information() {
    return {
      appVersion: this.options.appVersion,
      pwaVersion: this.options.pwaVersion,
      databaseVersion: await this.probe.databaseVersion(),
      dataDirectory: this.options.dataDirectory,
    };
  }
}
