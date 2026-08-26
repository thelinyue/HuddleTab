import { expect, it, vi } from "vitest";

import { ApplicationError } from "@/server/errors/application-error";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({
  requireSession: vi.fn().mockResolvedValue({ user: { id: "admin-1" } }),
}));
vi.mock("@/server/db/client", () => ({ sql: {} }));
vi.mock("@/server/permissions/require-system-admin", () => ({
  requireSystemAdmin: mocks.requireAdmin,
}));
vi.mock("@/server/backup/backup-service", () => ({
  createDatabaseBackupService: () => ({ create: mocks.create }),
  listBackups: mocks.list,
  deleteBackup: mocks.remove,
}));
vi.mock("@/server/backup/restore-service", () => ({
  createDatabaseRestoreService: () => ({ restore: mocks.restore }),
}));

import { GET, POST } from "@/app/api/admin/backups/route";
import { DELETE } from "@/app/api/admin/backups/[backupId]/route";
import { POST as restore } from "@/app/api/admin/backups/[backupId]/restore/route";

const context = { params: Promise.resolve({ backupId: "backup-1" }) };

it("仅系统管理员可列出和创建显式确认的备份", async () => {
  mocks.requireAdmin.mockResolvedValue("admin-1");
  mocks.list.mockResolvedValueOnce([
    {
      id: "backup-1",
      filename: "backup_1_test.tar.gz",
      sizeBytes: 125n,
      checksum: "abc",
      createdAt: new Date("2026-08-27T00:00:00.000Z"),
      status: "READY",
    },
  ]);
  mocks.create.mockResolvedValueOnce({
    id: "backup-2",
    filename: "backup_2_test.tar.gz",
    sizeBytes: 200n,
    checksum: "def",
    createdAt: new Date("2026-08-27T00:00:00.000Z"),
    status: "READY",
  });

  const list = await GET(new Request("http://localhost/api/admin/backups"));
  const create = await POST(
    new Request("http://localhost/api/admin/backups", {
      method: "POST",
      body: JSON.stringify({ confirmed: true }),
    }),
  );

  expect([list.status, create.status]).toEqual([200, 201]);
  expect(mocks.create).toHaveBeenCalledWith("admin-1");
  await expect(list.json()).resolves.toMatchObject({
    data: [{ id: "backup-1", sizeBytes: "125" }],
  });
  await expect(create.json()).resolves.toMatchObject({
    data: { id: "backup-2", sizeBytes: "200" },
  });
});

it("数据库驱动返回时间字符串时仍可序列化备份记录", async () => {
  mocks.requireAdmin.mockResolvedValue("admin-1");
  mocks.create.mockResolvedValueOnce({
    id: "backup-created-at-string",
    filename: "backup_3_test.tar.gz",
    sizeBytes: 300n,
    checksum: "ghi",
    createdAt: "2026-08-27T00:00:00.000Z",
    status: "READY",
  });

  const create = await POST(
    new Request("http://localhost/api/admin/backups", {
      method: "POST",
      body: JSON.stringify({ confirmed: true }),
    }),
  );

  expect(create.status).toBe(201);
  await expect(create.json()).resolves.toMatchObject({
    data: { createdAt: "2026-08-27T00:00:00.000Z" },
  });
});

it("拒绝未经明确确认的创建与恢复", async () => {
  mocks.requireAdmin.mockResolvedValue("admin-1");

  const create = await POST(
    new Request("http://localhost/api/admin/backups", {
      method: "POST",
      body: JSON.stringify({ confirmed: false }),
    }),
  );
  const restoreResponse = await restore(
    new Request("http://localhost/api/admin/backups/backup-1/restore", {
      method: "POST",
      body: JSON.stringify({ confirmed: false }),
    }),
    context,
  );

  expect([create.status, restoreResponse.status]).toEqual([422, 422]);
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.restore).not.toHaveBeenCalled();
});

it("删除与恢复保留平台权限和 RESTORE_FAILED 错误契约", async () => {
  mocks.requireAdmin.mockResolvedValueOnce("admin-1");
  mocks.remove.mockResolvedValueOnce(undefined);
  mocks.requireAdmin.mockResolvedValueOnce("admin-1");
  mocks.restore.mockRejectedValueOnce(
    new ApplicationError(
      "RESTORE_FAILED",
      "恢复失败，系统保持维护模式，请管理员查看部署日志并修复后重试。",
      500,
    ),
  );

  const removed = await DELETE(
    new Request("http://localhost/api/admin/backups/backup-1", {
      method: "DELETE",
    }),
    context,
  );
  const restored = await restore(
    new Request("http://localhost/api/admin/backups/backup-1/restore", {
      method: "POST",
      body: JSON.stringify({ confirmed: true }),
    }),
    context,
  );

  expect(removed.status).toBe(204);
  expect(mocks.remove).toHaveBeenCalledWith({}, "backup-1");
  expect(restored.status).toBe(500);
  await expect(restored.json()).resolves.toMatchObject({
    error: { code: "RESTORE_FAILED" },
  });
});
