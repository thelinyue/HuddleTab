// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ loader: vi.fn() }));

vi.mock("@/features/settlements/components/settlement-page-loader", () => ({
  SettlementPageLoader: (props: unknown) => {
    mocks.loader(props);
    return <p>结算路由</p>;
  },
}));

import SettlementsPage from "@/app/(product)/activities/[activityId]/settlements/page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete process.env.TZ;
});

test("结算路由显式传入部署时区并提供上海默认值", () => {
  process.env.TZ = "Pacific/Honolulu";
  const { rerender } = render(<SettlementsPage />);
  expect(screen.getByText("结算路由")).toBeVisible();
  expect(mocks.loader).toHaveBeenLastCalledWith({
    timeZone: "Pacific/Honolulu",
  });

  delete process.env.TZ;
  rerender(<SettlementsPage />);
  expect(mocks.loader).toHaveBeenLastCalledWith({ timeZone: "Asia/Shanghai" });
});
