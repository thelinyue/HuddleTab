import { randomUUID } from "node:crypto";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BackupService,
  deleteBackup,
  validateBackupArchive,
} from "@/server/backup/backup-service";
import {
  RestoreService,
  excludeMaintenanceStateFromRestoreList,
  restoreDatabaseDump,
} from "@/server/backup/restore-service";
import { MaintenanceMode } from "@/server/maintenance/maintenance-mode";
import { startPostgres } from "@/../tests/support/postgres";

const temporaryRoots: string[] = [];

async function temporaryRoot(label: string) {
  const root = join(tmpdir(), `huddletab-${label}-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("完整备份", () => {
  it("归档只包含 manifest、数据库 Dump 和常规 uploads 文件，不递归包含 backups", async () => {
    const dataRoot = await temporaryRoot("backup");
    const uploadsRoot = join(dataRoot, "uploads");
    const backupsRoot = join(dataRoot, "backups");
    await mkdir(join(uploadsRoot, "activity-1"), { recursive: true });
    await mkdir(backupsRoot, { recursive: true });
    await writeFile(join(uploadsRoot, "activity-1", "receipt.webp"), "image");
    await writeFile(join(backupsRoot, "old.tar.gz"), "old-backup");

    const record = await new BackupService({
      backupsRoot,
      uploadsRoot,
      createDatabaseDump: async (destination) => writeFile(destination, "dump"),
      createManifest: async () => ({ formatVersion: 1, appVersion: "test" }),
      recordReady: async (input) => ({ id: "backup-1", ...input }),
    }).create("admin-1");

    expect(record.sizeBytes).toBeGreaterThan(0n);
    expect(record.checksum).toMatch(/^[a-f0-9]{64}$/);
    await expect(validateBackupArchive(record.path)).resolves.toEqual([
      "database.dump",
      "manifest.json",
      "uploads/activity-1/receipt.webp",
    ]);
  });

  it("校验拒绝绝对路径、遍历路径、符号链接和未知根目录", async () => {
    await expect(
      validateBackupArchive({
        entries: [
          "manifest.json",
          "database.dump",
          { path: "uploads/linked.webp", type: "SymbolicLink" },
        ],
      }),
    ).rejects.toMatchObject({ code: "BACKUP_ARCHIVE_INVALID", status: 422 });
    await expect(
      validateBackupArchive({
        entries: ["manifest.json", "database.dump", "uploads/../secrets.txt"],
      }),
    ).rejects.toMatchObject({ code: "BACKUP_ARCHIVE_INVALID", status: 422 });
    await expect(
      validateBackupArchive({
        entries: ["manifest.json", "database.dump", "/uploads/receipt.webp"],
      }),
    ).rejects.toMatchObject({ code: "BACKUP_ARCHIVE_INVALID", status: 422 });
    await expect(
      validateBackupArchive({
        entries: ["manifest.json", "database.dump", "backups/old.tar.gz"],
      }),
    ).rejects.toMatchObject({ code: "BACKUP_ARCHIVE_INVALID", status: 422 });
  });

  it("拒绝缺少 uploads 根目录的非完整备份", async () => {
    await expect(
      validateBackupArchive({ entries: ["manifest.json", "database.dump"] }),
    ).rejects.toMatchObject({ code: "BACKUP_ARCHIVE_INVALID", status: 422 });
  });

  it("删除前拒绝解析到 backups 根目录外的元数据路径", async () => {
    const dataRoot = await temporaryRoot("delete-boundary");
    const outside = join(dataRoot, "outside.tar.gz");
    await writeFile(outside, "must-remain");
    const previousDataDirectory = process.env.DATA_DIR;
    process.env.DATA_DIR = dataRoot;
    const sql = vi.fn().mockResolvedValueOnce([
      {
        id: "backup-1",
        storage_path: outside,
        filename: "backup_1_00000000-0000-0000-0000-000000000000.tar.gz",
        size_bytes: 12n,
      },
    ]);
    try {
      await expect(
        deleteBackup(sql as never, "backup-1"),
      ).rejects.toMatchObject({
        code: "BACKUP_PATH_INVALID",
        status: 422,
      });
      await expect(access(outside)).resolves.toBeUndefined();
      expect(sql).toHaveBeenCalledOnce();
    } finally {
      if (previousDataDirectory === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previousDataDirectory;
    }
  });
});

describe("恢复边界", () => {
  it("恢复清单只排除维护状态，避免清除全程维护闸门而保留系统设置", () => {
    const list = [
      "; Archive created at 2026-08-27 00:00:00 UTC",
      "100; 1259 100 TABLE public user postgres",
      "101; 1259 101 TABLE public system_settings postgres",
      "102; 0 101 TABLE DATA public system_settings postgres",
      "103; 1259 102 TABLE public maintenance_state postgres",
      "104; 0 102 TABLE DATA public maintenance_state postgres",
      "105; 1259 103 TABLE public activity postgres",
      "104; 0 100 TABLE DATA public user postgres",
    ].join("\n");

    expect(excludeMaintenanceStateFromRestoreList(list)).toEqual(
      [
        "; Archive created at 2026-08-27 00:00:00 UTC",
        "100; 1259 100 TABLE public user postgres",
        "101; 1259 101 TABLE public system_settings postgres",
        "102; 0 101 TABLE DATA public system_settings postgres",
        "105; 1259 103 TABLE public activity postgres",
        "104; 0 100 TABLE DATA public user postgres",
      ].join("\n"),
    );
  });

  it("恢复数据库时使用过滤后的清单，避免归档覆盖维护闸门", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        stdout: "101; 1259 101 TABLE public maintenance_state postgres\n",
      })
      .mockResolvedValueOnce({});

    const work = await temporaryRoot("restore-list");
    const dumpPath = join(work, "database.dump");
    await writeFile(dumpPath, "test dump");

    await restoreDatabaseDump(
      dumpPath,
      "postgresql://user:secret@db/huddletab",
      execute,
    );

    expect(execute).toHaveBeenNthCalledWith(
      1,
      "pg_restore",
      ["--list", dumpPath],
      { windowsHide: true },
    );
    expect(execute).toHaveBeenNthCalledWith(
      2,
      "pg_restore",
      expect.arrayContaining([
        "--clean",
        "--if-exists",
        "--use-list",
        dumpPath,
      ]),
      { windowsHide: true },
    );
    expect(execute.mock.calls[1]?.[1]).not.toContain(
      "--exclude-table=system_settings",
    );
  });

  it("恢复失败后保持维护模式，并返回可读的 RESTORE_FAILED 错误", async () => {
    const maintenance = {
      enter: vi.fn(),
      leave: vi.fn(),
    };
    const failure = new Error("pg_restore exited 1");
    const service = new RestoreService({
      requireReady: async () => ({
        id: "backup-1",
        path: "/data/backups/backup.tar.gz",
      }),
      validate: async () => ({ formatVersion: 1, appVersion: "test" }),
      assertCompatible: async () => undefined,
      maintenance,
      restoreDatabase: async () => {
        throw failure;
      },
      replaceUploads: async () => undefined,
      runMigrations: async () => undefined,
      runSmokeCheck: async () => undefined,
    });

    await expect(service.restore("backup-1", "admin-1")).rejects.toMatchObject({
      code: "RESTORE_FAILED",
      status: 500,
      message: expect.stringContaining("维护模式"),
    });
    expect(maintenance.enter).toHaveBeenCalledWith("RESTORE", "admin-1");
    expect(maintenance.leave).not.toHaveBeenCalled();
  });

  it("只有数据库、上传文件、迁移、兼容检查和 smoke 全部完成后才退出维护模式", async () => {
    const calls: string[] = [];
    const service = new RestoreService({
      requireReady: async () => ({
        id: "backup-1",
        path: "/data/backups/backup.tar.gz",
      }),
      validate: async () => {
        calls.push("validate");
        return { formatVersion: 1, appVersion: "test" };
      },
      assertCompatible: async () => {
        calls.push("compatible");
      },
      maintenance: {
        enter: async () => {
          calls.push("enter");
        },
        leave: async () => {
          calls.push("leave");
        },
      },
      restoreDatabase: async () => {
        calls.push("database");
      },
      replaceUploads: async () => {
        calls.push("uploads");
      },
      runMigrations: async () => {
        calls.push("migrations");
      },
      runSmokeCheck: async () => {
        calls.push("smoke");
      },
    });

    await service.restore("backup-1", "admin-1");

    expect(calls).toEqual([
      "validate",
      "compatible",
      "enter",
      "database",
      "uploads",
      "migrations",
      "smoke",
      "leave",
    ]);
  });
});

describe("维护模式", () => {
  it("并发恢复时只有一个请求能取得维护模式", async () => {
    let active = false;
    const sql = Object.assign(
      async (strings: TemplateStringsArray) => {
        const query = strings.join(" ");
        if (query.includes("insert into maintenance_state")) return [];
        if (
          query.includes("update maintenance_state") &&
          query.includes("active = false")
        ) {
          if (active) return [];
          active = true;
          return [{ id: "singleton" }];
        }
        throw new Error(`未预期查询：${query}`);
      },
      {
        begin: async (callback: (transaction: unknown) => Promise<unknown>) =>
          callback(sql),
      },
    );
    const maintenance = new MaintenanceMode(sql as never);

    const results = await Promise.allSettled([
      maintenance.enter("RESTORE", "admin-1"),
      maintenance.enter("RESTORE", "admin-2"),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({
      reason: { code: "MAINTENANCE_MODE", status: 503 },
    });
  });

  it("独立维护状态阻止业务写入，并返回 503 MAINTENANCE_MODE", async () => {
    let active = false;
    const sql = Object.assign(
      async (strings: TemplateStringsArray) => {
        const query = strings.join(" ");
        if (query.includes("select active from maintenance_state"))
          return [{ active }];
        throw new Error(`未预期查询：${query}`);
      },
      {
        begin: async (callback: (transaction: unknown) => Promise<unknown>) =>
          callback(sql),
      },
    );
    const maintenance = new MaintenanceMode(sql as never);

    active = true;
    await expect(maintenance.assertWritesAllowed()).rejects.toMatchObject({
      code: "MAINTENANCE_MODE",
      status: 503,
      message: expect.stringContaining("维护"),
    });
  });

  it("在真实 PostgreSQL 中原子领取维护模式并阻止后续写入", async () => {
    const harness = await startPostgres();
    try {
      await harness.seedCredentialUser(
        "maintenance-admin-1",
        "one@example.com",
      );
      await harness.seedCredentialUser(
        "maintenance-admin-2",
        "two@example.com",
      );
      const first = new MaintenanceMode(harness.sql);
      const second = new MaintenanceMode(harness.sql);

      const results = await Promise.allSettled([
        first.enter("RESTORE", "maintenance-admin-1"),
        second.enter("RESTORE", "maintenance-admin-2"),
      ]);

      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        results.find((result) => result.status === "rejected"),
      ).toMatchObject({
        reason: { code: "MAINTENANCE_MODE", status: 503 },
      });
      await expect(first.assertWritesAllowed()).rejects.toMatchObject({
        code: "MAINTENANCE_MODE",
        status: 503,
      });
    } finally {
      await harness.stop();
    }
  });
});
