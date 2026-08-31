import { afterEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ redirect: vi.fn() }));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

import SettlementsPage from "@/app/(product)/activities/[activityId]/settlements/page";

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.TZ;
});

test("旧结算路由在服务端 replace 到活动结算 Tab", async () => {
  await SettlementsPage({
    params: Promise.resolve({ activityId: "activity-1" }),
  });

  expect(mocks.redirect).toHaveBeenCalledWith(
    "/activities/activity-1?tab=settlement",
  );
});
