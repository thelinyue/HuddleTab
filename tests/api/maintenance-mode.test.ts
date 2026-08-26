import { expect, it, vi } from "vitest";

import { ApplicationError } from "@/server/errors/application-error";

const mocks = vi.hoisted(() => ({
  assertWritesAllowed: vi.fn(),
  activityCreate: vi.fn(),
  attachmentUpload: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({
  requireSession: vi.fn().mockResolvedValue({ user: { id: "member-1" } }),
  sessionUserId: vi.fn(() => "member-1"),
}));
vi.mock("@/server/db/client", () => ({
  sql: Object.assign(vi.fn().mockResolvedValue([{ nickname: "成员" }]), {
    begin: vi.fn(),
  }),
}));
vi.mock("@/server/maintenance/maintenance-mode", () => ({
  MaintenanceMode: class {
    assertWritesAllowed = mocks.assertWritesAllowed;
  },
}));
vi.mock("@/server/services/activity-service", () => ({
  ActivityService: class {
    create = mocks.activityCreate;
  },
}));
vi.mock("@/server/services/attachment-service", () => ({
  AttachmentService: class {
    upload = mocks.attachmentUpload;
  },
}));

import { POST as createActivity } from "@/app/api/activities/route";
import { POST as uploadAttachment } from "@/app/api/activities/[activityId]/expenses/[expenseId]/attachments/route";

const maintenanceError = new ApplicationError(
  "MAINTENANCE_MODE",
  "系统正在维护恢复中，暂时不能写入数据，请稍后重试。",
  503,
);

it("维护模式在创建活动前拒绝业务写入", async () => {
  mocks.assertWritesAllowed.mockRejectedValueOnce(maintenanceError);

  const response = await createActivity(
    new Request("http://localhost/api/activities", {
      method: "POST",
      body: JSON.stringify({
        name: "维护期间活动",
        baseCurrency: "CNY",
        startDate: "2026-08-27",
      }),
    }),
  );

  expect(response.status).toBe(503);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "MAINTENANCE_MODE" },
  });
  expect(mocks.activityCreate).not.toHaveBeenCalled();
});

it("维护模式在解析附件前拒绝上传", async () => {
  mocks.assertWritesAllowed.mockRejectedValueOnce(maintenanceError);
  const form = new FormData();
  form.set("clientAttachmentId", "174c77aa-a6fa-4f86-922a-1f765a9c9e65");
  form.set("file", new File(["png"], "receipt.png", { type: "image/png" }));

  const response = await uploadAttachment(
    new Request("http://localhost/api/activities/a1/expenses/e1/attachments", {
      method: "POST",
      body: form,
    }),
    { params: Promise.resolve({ activityId: "a1", expenseId: "e1" }) },
  );

  expect(response.status).toBe(503);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "MAINTENANCE_MODE" },
  });
  expect(mocks.attachmentUpload).not.toHaveBeenCalled();
});
