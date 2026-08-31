import { access, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { OrphanAttachmentCleanup } from "@/server/jobs/orphan-attachment-cleanup";

const temporaryRoots: string[] = [];
const now = new Date("2026-08-26T12:00:00.000Z");

async function createFile(root: string, storageKey: string, modifiedAt: Date) {
  const path = join(root, ...storageKey.split("/"));
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, "image");
  await utimes(path, modifiedAt, modifiedAt);
}

function createSql(metadataKeys: ReadonlySet<string>) {
  return (async (_strings: TemplateStringsArray, storageKey: string) => [
    { exists: metadataKeys.has(storageKey) },
  ]) as never;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("孤立附件清理", () => {
  it("递归删除超过 24 小时且没有元数据的文件", async () => {
    const root = await createTemporaryRoot();
    const orphanKey = "activity/expense/orphan.webp";
    const retainedKey = "activity/expense/retained.webp";
    const recentKey = "activity/recent.webp";
    await createFile(root, orphanKey, new Date("2026-08-25T11:59:59.000Z"));
    await createFile(root, retainedKey, new Date("2026-08-25T11:59:59.000Z"));
    await createFile(root, recentKey, new Date("2026-08-25T12:00:00.000Z"));
    const logger = { info: vi.fn() };

    const result = await new OrphanAttachmentCleanup(
      createSql(new Set([retainedKey])),
      {
        uploadsRoot: root,
        now: () => now,
        logger,
      },
    ).run();

    await expect(fileExists(join(root, ...orphanKey.split("/")))).resolves.toBe(
      false,
    );
    await expect(
      fileExists(join(root, ...retainedKey.split("/"))),
    ).resolves.toBe(true);
    await expect(fileExists(join(root, ...recentKey.split("/")))).resolves.toBe(
      true,
    );
    expect(result).toEqual({ scanned: 3, deleted: 1, skipped: false });
    expect(logger.info).toHaveBeenCalledWith(
      "孤立附件清理完成：扫描 3 个文件，删除 1 个文件。",
    );
  });

  it("将元数据查询失败直接返回给调用方", async () => {
    const root = await createTemporaryRoot();
    const orphanKey = "activity/expense/orphan.webp";
    await createFile(root, orphanKey, new Date("2026-08-25T11:59:59.000Z"));
    const failure = new Error("数据库暂时不可用");
    const sql = vi.fn().mockRejectedValue(failure);

    await expect(
      new OrphanAttachmentCleanup(sql as never, {
        uploadsRoot: root,
        now: () => now,
      }).run(),
    ).rejects.toBe(failure);
  });

  it("将文件删除失败直接返回给调用方", async () => {
    const root = await createTemporaryRoot();
    const orphanKey = "activity/expense/orphan.webp";
    await createFile(root, orphanKey, new Date("2026-08-25T11:59:59.000Z"));
    const failure = new Error("存储暂时不可写");

    await expect(
      new OrphanAttachmentCleanup(createSql(new Set()), {
        uploadsRoot: root,
        now: () => now,
        removeFile: async () => {
          throw failure;
        },
      }).run(),
    ).rejects.toBe(failure);
  });
});

async function createTemporaryRoot() {
  const root = join(
    tmpdir(),
    `huddletab-orphan-attachment-cleanup-${randomUUID()}`,
  );
  await mkdir(root, { recursive: true });
  temporaryRoots.push(root);
  return root;
}

async function fileExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
