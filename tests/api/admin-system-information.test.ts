import { expect, it, vi } from "vitest";

import { ApplicationError } from "@/server/errors/application-error";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  storage: vi.fn(),
  information: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({
  requireSession: vi.fn().mockResolvedValue({ user: { id: "admin-1" } }),
}));
vi.mock("@/server/db/client", () => ({ sql: {} }));
vi.mock("@/server/permissions/require-system-admin", () => ({
  requireSystemAdmin: mocks.requireAdmin,
}));
vi.mock("@/server/services/system-information-service", () => ({
  SystemProbe: class {},
  SystemInformationService: class {
    storage = mocks.storage;
    information = mocks.information;
  },
}));

import { GET as getStorage } from "@/app/api/admin/storage/route";
import { GET as getInformation } from "@/app/api/admin/system-information/route";

it("系统管理员可以读取存储统计和系统信息", async () => {
  mocks.requireAdmin.mockResolvedValue("admin-1");
  mocks.storage.mockResolvedValue({
    databaseBytes: "100",
    uploadsBytes: "20",
    backupsBytes: "5",
    totalBytes: "125",
  });
  mocks.information.mockResolvedValue({
    appVersion: "1.0.0",
    pwaVersion: "1.0.0-pwa",
    databaseVersion: "PostgreSQL 18.0",
    dataDirectory: "/srv/huddletab/data",
  });

  const [storage, information] = await Promise.all([
    getStorage(new Request("http://localhost/api/admin/storage")),
    getInformation(
      new Request("http://localhost/api/admin/system-information"),
    ),
  ]);

  expect([storage.status, information.status]).toEqual([200, 200]);
  expect(mocks.requireAdmin).toHaveBeenCalledTimes(2);
  await expect(information.json()).resolves.toMatchObject({
    data: { dataDirectory: "/srv/huddletab/data" },
  });
});

it.each([
  [
    "普通成员",
    new ApplicationError("SYSTEM_ADMIN_REQUIRED", "需要系统管理员权限。", 403),
  ],
  [
    "已禁用管理员",
    new ApplicationError(
      "ACCOUNT_DISABLED",
      "账号已被禁用，无法执行系统管理操作。",
      403,
    ),
  ],
])("%s 不能获得数据目录", async (_name, error) => {
  mocks.requireAdmin.mockRejectedValueOnce(error);

  const response = await getInformation(
    new Request("http://localhost/api/admin/system-information"),
  );
  const body = await response.json();

  expect(response.status).toBe(403);
  expect(body).toMatchObject({
    error: { code: error.code, message: expect.any(String) },
  });
  expect(body).not.toMatchObject({
    data: expect.objectContaining({ dataDirectory: expect.anything() }),
  });
});
