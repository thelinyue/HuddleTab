// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connection: vi.fn(), page: vi.fn() }));

vi.mock("next/server", () => ({ connection: mocks.connection }));

vi.mock("@/features/notifications/components/notifications-page", () => ({
  NotificationsPage: (props: unknown) => {
    mocks.page(props);
    return <p>通知路由</p>;
  },
}));

import NotificationsRoute from "@/app/(product)/notifications/page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete process.env.TZ;
});

test("通知路由在请求时传入部署时区并提供上海默认值", async () => {
  process.env.TZ = "Pacific/Honolulu";
  const { rerender } = render(await NotificationsRoute());
  expect(mocks.connection).toHaveBeenCalledOnce();
  expect(screen.getByText("通知路由")).toBeVisible();
  expect(mocks.page).toHaveBeenLastCalledWith({
    timeZone: "Pacific/Honolulu",
  });

  delete process.env.TZ;
  rerender(await NotificationsRoute());
  expect(mocks.page).toHaveBeenLastCalledWith({ timeZone: "Asia/Shanghai" });
});
