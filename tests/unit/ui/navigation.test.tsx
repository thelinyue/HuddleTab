// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import {
  BottomNavigation,
  ProductNavigation,
} from "@/components/design-system/bottom-navigation";
import { ActivityNavigation } from "@/features/activities/components/activity-navigation";
import { NOTIFICATION_UNREAD_COUNT_EVENT } from "@/lib/notification-unread-count";

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

  act(() => {
    window.dispatchEvent(
      new CustomEvent(NOTIFICATION_UNREAD_COUNT_EVENT, { detail: 0 }),
    );
  });
  expect(screen.getByRole("link", { name: "通知" })).toBeVisible();
});

test("未读事件发生后忽略更晚返回的陈旧初始请求", async () => {
  let resolveRequest: ((value: unknown) => void) | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    ),
  );

  render(<ProductNavigation unreadCount={2} />);
  act(() => {
    window.dispatchEvent(
      new CustomEvent(NOTIFICATION_UNREAD_COUNT_EVENT, { detail: 0 }),
    );
  });
  expect(screen.getByRole("link", { name: "通知" })).toBeVisible();

  await act(async () => {
    resolveRequest?.({
      ok: true,
      json: async () => ({ data: { unreadCount: 2 } }),
    });
  });
  expect(screen.getByRole("link", { name: "通知" })).toBeVisible();
});

test("从活动详情返回后忽略更早一轮的乱序未读响应", async () => {
  const requests: Array<(value: unknown) => void> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          requests.push(resolve);
        }),
    ),
  );

  const { rerender } = render(<ProductNavigation />);
  navigation.pathname = "/activities/activity-42";
  rerender(<ProductNavigation />);
  navigation.pathname = "/activities";
  rerender(<ProductNavigation />);

  await act(async () => {
    requests[1]?.({
      ok: true,
      json: async () => ({ data: { unreadCount: 1 } }),
    });
  });
  expect(screen.getByRole("link", { name: "通知，1 条未读" })).toBeVisible();

  await act(async () => {
    requests[0]?.({
      ok: true,
      json: async () => ({ data: { unreadCount: 3 } }),
    });
  });
  expect(screen.getByRole("link", { name: "通知，1 条未读" })).toBeVisible();
});

test("活动详情路径下隐藏一级导航", () => {
  navigation.pathname = "/activities/activity-42";
  render(<ProductNavigation />);

  expect(
    screen.queryByRole("navigation", { name: "主导航" }),
  ).not.toBeInTheDocument();
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
  expect(document.querySelectorAll('[aria-label="活动导航"] svg')).toHaveLength(
    4,
  );
});
