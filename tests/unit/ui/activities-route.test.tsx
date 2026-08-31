// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connection: vi.fn(), loader: vi.fn() }));

vi.mock("next/server", () => ({ connection: mocks.connection }));
vi.mock("@/features/activities/components/activity-home", () => ({
  ActivityHomeLoader: (props: unknown) => {
    mocks.loader(props);
    return <p>活动路由</p>;
  },
}));

import ActivitiesPage from "@/app/(product)/activities/page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete process.env.TZ;
});

test("活动路由在请求时传入部署时区并提供上海默认值", async () => {
  process.env.TZ = "Pacific/Honolulu";
  const { rerender } = render(await ActivitiesPage());
  expect(mocks.connection).toHaveBeenCalledOnce();
  expect(screen.getByText("活动路由")).toBeVisible();
  expect(mocks.loader).toHaveBeenLastCalledWith({
    timeZone: "Pacific/Honolulu",
  });

  delete process.env.TZ;
  rerender(await ActivitiesPage());
  expect(mocks.loader).toHaveBeenLastCalledWith({ timeZone: "Asia/Shanghai" });
});
