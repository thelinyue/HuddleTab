import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type postgres from "postgres";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SystemInformationService,
  SystemProbe,
} from "@/server/services/system-information-service";

const temporaryDirectories: string[] = [];

async function temporaryDataDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "huddletab-system-info-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      const { rm } = await import("node:fs/promises");
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("SystemInformationService", () => {
  it("返回数据库、上传、备份及总计的十进制字节字符串", async () => {
    const service = new SystemInformationService(
      {
        databaseBytes: async () => 100n,
        directoryBytes: async (name) => (name === "uploads" ? 20n : 5n),
        databaseVersion: async () => "PostgreSQL 18.0",
      },
      {
        appVersion: "1.0.0",
        pwaVersion: "1.0.0-pwa",
        dataDirectory: "/srv/huddletab/data",
      },
    );

    await expect(service.storage()).resolves.toEqual({
      databaseBytes: "100",
      uploadsBytes: "20",
      backupsBytes: "5",
      totalBytes: "125",
    });
  });

  it("汇总超出 Number 安全范围时保持 bigint 精度", async () => {
    const service = new SystemInformationService(
      {
        databaseBytes: async () => 9_007_199_254_740_993n,
        directoryBytes: async (name) => (name === "uploads" ? 7n : 11n),
        databaseVersion: async () => "PostgreSQL 18.0",
      },
      { appVersion: "dev", pwaVersion: "dev", dataDirectory: "/data" },
    );

    await expect(service.storage()).resolves.toEqual({
      databaseBytes: "9007199254740993",
      uploadsBytes: "7",
      backupsBytes: "11",
      totalBytes: "9007199254741011",
    });
  });

  it.skipIf(process.platform === "win32")(
    "递归统计普通文件，忽略符号链接及其目标",
    async () => {
      const dataDirectory = await temporaryDataDirectory();
      await mkdir(join(dataDirectory, "uploads", "nested"), {
        recursive: true,
      });
      await writeFile(
        join(dataDirectory, "uploads", "first.bin"),
        Buffer.alloc(7),
      );
      await writeFile(
        join(dataDirectory, "uploads", "nested", "second.bin"),
        Buffer.alloc(13),
      );
      const target = join(dataDirectory, "outside.bin");
      await writeFile(target, Buffer.alloc(97));
      await symlink(target, join(dataDirectory, "uploads", "outside-link"));

      await mkdir(join(dataDirectory, "outside-backups"));
      await writeFile(
        join(dataDirectory, "outside-backups", "archive.tar.gz"),
        Buffer.alloc(101),
      );
      await symlink(
        join(dataDirectory, "outside-backups"),
        join(dataDirectory, "backups"),
      );

      const probe = new SystemProbe(
        vi.fn() as unknown as ReturnType<typeof postgres>,
        dataDirectory,
      );

      await expect(probe.directoryBytes("uploads")).resolves.toBe(20n);
      await expect(probe.directoryBytes("backups")).resolves.toBe(0n);
    },
  );

  it("拒绝目录片段和遍历名称", async () => {
    const probe = new SystemProbe(
      vi.fn() as unknown as ReturnType<typeof postgres>,
      await temporaryDataDirectory(),
    );

    await expect(probe.directoryBytes("../uploads" as never)).rejects.toThrow(
      "仅允许统计 uploads 或 backups 目录。",
    );
    await expect(
      probe.directoryBytes("uploads/nested" as never),
    ).rejects.toThrow("仅允许统计 uploads 或 backups 目录。");
  });

  it("探针使用数据库自身大小与版本查询", async () => {
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const statement = strings.join("?");
      if (statement.includes("pg_database_size"))
        return [{ bytes: "12345678901234567890" }];
      return [{ version: "PostgreSQL 18.1" }];
    });
    const probe = new SystemProbe(
      sql as unknown as ReturnType<typeof postgres>,
      await temporaryDataDirectory(),
    );

    await expect(probe.databaseBytes()).resolves.toBe(
      12_345_678_901_234_567_890n,
    );
    await expect(probe.databaseVersion()).resolves.toBe("PostgreSQL 18.1");
    expect(sql.mock.calls.map(([strings]) => strings.join("?"))).toEqual(
      expect.arrayContaining([
        expect.stringContaining("pg_database_size(current_database())"),
        expect.stringContaining("version()"),
      ]),
    );
  });
});
