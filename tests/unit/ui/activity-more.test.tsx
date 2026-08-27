// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const navigation = vi.hoisted(() => ({ activityId: "activity-1" }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ activityId: navigation.activityId }),
}));

import { ActivityMore } from "@/features/activities/components/activity-more";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("更多页展示真实摘要、导出和当前生命周期状态", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { activity: { status: "ACTIVE", currentMemberRole: "ADMIN" } },
      }),
    }),
  );

  render(<ActivityMore />);

  expect(await screen.findByText("进行中")).toBeVisible();
  expect(screen.getByRole("link", { name: "结算摘要" })).toHaveAttribute(
    "href",
    "/activities/activity-1/summary",
  );
  expect(screen.getByRole("link", { name: "导出 CSV" })).toHaveAttribute(
    "href",
    "/api/activities/activity-1/export.csv",
  );
  expect(screen.getByRole("button", { name: "结束活动" })).toBeVisible();
});

test("离线时活动操作提示具有状态语义", async () => {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { activity: { status: "ACTIVE", currentMemberRole: "OWNER" } },
      }),
    }),
  );

  render(<ActivityMore />);

  expect(await screen.findByRole("status")).toHaveTextContent(
    "活动操作必须联网后执行。",
  );
  expect(screen.getByRole("button", { name: "结束活动" })).toBeDisabled();
});
