import { expect, it, vi } from "vitest";

import { ApplicationError } from "@/server/errors/application-error";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  disableUser: vi.fn(),
  enableUser: vi.fn(),
  deleteUser: vi.fn(),
  grantSystemAdmin: vi.fn(),
  revokeSystemAdmin: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({
  requireSession: vi.fn().mockResolvedValue({ user: { id: "admin-1" } }),
}));
vi.mock("@/server/db/client", () => ({ sql: {} }));
vi.mock("@/server/permissions/require-system-admin", () => ({
  requireSystemAdmin: mocks.requireAdmin,
}));
vi.mock("@/server/services/system-admin-service", () => ({
  SystemAdminService: class {
    disableUser = mocks.disableUser;
    enableUser = mocks.enableUser;
    deleteUser = mocks.deleteUser;
    grantSystemAdmin = mocks.grantSystemAdmin;
    revokeSystemAdmin = mocks.revokeSystemAdmin;
  },
}));

import {
  DELETE as deleteUser,
  PATCH as changeStatus,
} from "@/app/api/admin/users/[userId]/status/route";
import { PATCH as changeSystemAdmin } from "@/app/api/admin/users/[userId]/system-admin/route";

const context = { params: Promise.resolve({ userId: "target-1" }) };

it("状态路由经平台管理员守卫分发禁用、启用和删除", async () => {
  mocks.requireAdmin.mockResolvedValue("admin-1");

  const disabled = await changeStatus(
    new Request("http://localhost/api/admin/users/target-1/status", {
      method: "PATCH",
      body: JSON.stringify({ disabled: true }),
    }),
    context,
  );
  const enabled = await changeStatus(
    new Request("http://localhost/api/admin/users/target-1/status", {
      method: "PATCH",
      body: JSON.stringify({ disabled: false }),
    }),
    context,
  );
  const deleted = await deleteUser(
    new Request("http://localhost/api/admin/users/target-1/status", {
      method: "DELETE",
    }),
    context,
  );

  expect(mocks.requireAdmin).toHaveBeenCalledTimes(3);
  expect(mocks.disableUser).toHaveBeenCalledWith("target-1");
  expect(mocks.enableUser).toHaveBeenCalledWith("target-1");
  expect(mocks.deleteUser).toHaveBeenCalledWith("target-1");
  expect([disabled.status, enabled.status, deleted.status]).toEqual([
    200, 200, 200,
  ]);
});

it("角色路由分发授予和撤销，并传入当前管理员", async () => {
  mocks.requireAdmin.mockResolvedValue("admin-1");

  const granted = await changeSystemAdmin(
    new Request("http://localhost/api/admin/users/target-1/system-admin", {
      method: "PATCH",
      body: JSON.stringify({ granted: true }),
    }),
    context,
  );
  const revoked = await changeSystemAdmin(
    new Request("http://localhost/api/admin/users/target-1/system-admin", {
      method: "PATCH",
      body: JSON.stringify({ granted: false }),
    }),
    context,
  );

  expect(mocks.grantSystemAdmin).toHaveBeenCalledWith("target-1", "admin-1");
  expect(mocks.revokeSystemAdmin).toHaveBeenCalledWith("target-1");
  expect(granted.status).toBe(200);
  expect(revoked.status).toBe(200);
});

it("保留禁用调用者与最后管理员的错误契约", async () => {
  mocks.requireAdmin.mockRejectedValueOnce(
    new ApplicationError(
      "ACCOUNT_DISABLED",
      "账号已被禁用，无法执行系统管理操作。",
      403,
    ),
  );
  const disabled = await changeStatus(
    new Request("http://localhost/api/admin/users/target-1/status", {
      method: "PATCH",
      body: JSON.stringify({ disabled: true }),
    }),
    context,
  );
  mocks.requireAdmin.mockResolvedValueOnce("admin-1");
  mocks.revokeSystemAdmin.mockRejectedValueOnce(
    new ApplicationError(
      "LAST_ACTIVE_ADMIN",
      "系统必须至少保留一个能够正常登录的系统管理员。",
      409,
    ),
  );
  const lastAdmin = await changeSystemAdmin(
    new Request("http://localhost/api/admin/users/target-1/system-admin", {
      method: "PATCH",
      body: JSON.stringify({ granted: false }),
    }),
    context,
  );

  expect(disabled.status).toBe(403);
  expect(await disabled.json()).toMatchObject({
    error: {
      code: "ACCOUNT_DISABLED",
      message: expect.stringContaining("禁用"),
    },
  });
  expect(lastAdmin.status).toBe(409);
  expect(await lastAdmin.json()).toMatchObject({
    error: { code: "LAST_ACTIVE_ADMIN" },
  });
});
