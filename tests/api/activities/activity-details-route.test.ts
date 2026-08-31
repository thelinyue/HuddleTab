import { expect, it, vi } from "vitest";

import { ApplicationError } from "@/server/errors/application-error";

const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));

vi.mock("@/server/auth/session", () => ({
  requireSession: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
  sessionUserId: vi.fn().mockReturnValue("user-1"),
}));
vi.mock("@/server/db/client", () => ({ sql: {} }));
vi.mock("@/server/services/activity-details-service", () => ({
  ActivityDetailsService: class {
    get = mocks.get;
    update = mocks.update;
  },
}));

import {
  GET,
  PATCH,
} from "@/app/api/activities/[activityId]/route";

const context = { params: Promise.resolve({ activityId: "activity-1" }) };
const details = {
  id: "activity-1",
  name: "大阪行",
  location: "日本大阪",
  baseCurrency: "CNY",
  startDate: "2026-08-31",
  endDate: null,
  status: "ACTIVE",
  revision: "2",
  currentMemberRole: "OWNER",
  currentMemberStatus: "ACTIVE",
  hasAccountingRecords: false,
  earliestExpenseDate: null,
  permissions: {
    name: true,
    location: true,
    baseCurrency: true,
    startDate: true,
    endDate: true,
  },
};

it("GET 返回活动详情与字段级权限", async () => {
  mocks.get.mockResolvedValue(details);

  const response = await GET(
    new Request("http://localhost/api/activities/activity-1"),
    context,
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: details });
  expect(mocks.get).toHaveBeenCalledWith(
    { user: { id: "user-1" } },
    "activity-1",
  );
});

it("PATCH 传递部分字段并返回更新详情和日期警告", async () => {
  mocks.update.mockResolvedValue({
    activity: { ...details, baseCurrency: "JPY", revision: "3" },
    warnings: ["EXPENSE_BEFORE_ACTIVITY_START"],
  });

  const response = await PATCH(
    new Request("http://localhost/api/activities/activity-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        revision: "2",
        baseCurrency: "JPY",
        endDate: null,
      }),
    }),
    context,
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    data: { baseCurrency: "JPY", revision: "3" },
    warnings: ["EXPENSE_BEFORE_ACTIVITY_START"],
  });
  expect(mocks.update).toHaveBeenCalledWith(
    { user: { id: "user-1" } },
    "activity-1",
    { revision: "2", baseCurrency: "JPY", endDate: null },
  );
});

it("PATCH 在服务层前拒绝目录外币种并映射稳定业务错误", async () => {
  const invalid = await PATCH(
    new Request("http://localhost/api/activities/activity-1", {
      method: "PATCH",
      body: JSON.stringify({ revision: "2", baseCurrency: "BTC" }),
    }),
    context,
  );
  expect(invalid.status).toBe(422);
  expect(await invalid.json()).toMatchObject({
    error: { code: "VALIDATION_ERROR" },
  });
  expect(mocks.update).not.toHaveBeenCalled();

  mocks.update.mockRejectedValueOnce(
    new ApplicationError(
      "BASE_CURRENCY_LOCKED",
      "活动已有账务记录，主币种不可修改。",
      409,
    ),
  );
  const locked = await PATCH(
    new Request("http://localhost/api/activities/activity-1", {
      method: "PATCH",
      body: JSON.stringify({ revision: "2", baseCurrency: "JPY" }),
    }),
    context,
  );
  expect(locked.status).toBe(409);
  expect((await locked.json()).error.code).toBe("BASE_CURRENCY_LOCKED");
});
