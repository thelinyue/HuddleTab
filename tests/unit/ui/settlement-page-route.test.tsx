// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ activityId: "activity-1" }),
  useRouter: () => ({ replace: mocks.replace }),
}));

import SettlementsPage from "@/app/(product)/activities/[activityId]/settlements/page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete process.env.TZ;
});

test("旧结算路由 replace 到活动结算 Tab", async () => {
  render(<SettlementsPage />);
  expect(screen.getByText("正在打开活动…")).toBeVisible();
  await waitFor(() =>
    expect(mocks.replace).toHaveBeenCalledWith(
      "/activities/activity-1?tab=settlement",
    ),
  );
});
