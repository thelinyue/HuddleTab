// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import {
  BottomNavigation,
  ProductNavigation,
} from "@/components/design-system/bottom-navigation";
import { ActivityNavigation } from "@/features/activities/components/activity-navigation";

const navigation = vi.hoisted(() => ({
  activityId: "activity-42",
  pathname: "/activities",
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ activityId: navigation.activityId }),
  usePathname: () => navigation.pathname,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  navigation.pathname = "/activities";
});

test("一级导航只有活动、通知、我的，并提供当前项语义", () => {
  render(<BottomNavigation current="activities" unreadCount={3} />);

  expect(screen.getAllByRole("link")).toHaveLength(3);
  expect(screen.getByRole("link", { name: "活动" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByRole("link", { name: /通知，3 条未读/ })).toBeVisible();
});

test("一级导航加载服务器未读通知数", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { unreadCount: 2 } }),
    }),
  );

  render(<ProductNavigation />);

  expect(
    await screen.findByRole("link", { name: "通知，2 条未读" }),
  ).toBeVisible();
});

test("活动导航保留四个带图标的深链接和当前项语义", () => {
  navigation.pathname = "/activities/activity-42/members";
  render(<ActivityNavigation />);

  expect(screen.getAllByRole("link")).toHaveLength(4);
  expect(screen.getByRole("link", { name: "流水" })).toHaveAttribute(
    "href",
    "/activities/activity-42",
  );
  expect(screen.getByRole("link", { name: "结算" })).toHaveAttribute(
    "href",
    "/activities/activity-42/settlements",
  );
  expect(screen.getByRole("link", { name: "成员" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByRole("link", { name: "更多" })).toHaveAttribute(
    "href",
    "/activities/activity-42/more",
  );
  expect(document.querySelectorAll('[aria-label="活动导航"] svg')).toHaveLength(4);
});
