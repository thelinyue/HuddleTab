// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import {
  BottomNavigation,
  ProductNavigation,
} from "@/components/design-system/bottom-navigation";
import { ActivityNavigation } from "@/features/activities/components/activity-navigation";
import { ActivityPageHeader } from "@/features/activities/components/activity-page-header";
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

test("活动流水同时保留全局导航", () => {
  navigation.pathname = "/activities/activity-42";
  render(<ProductNavigation />);

  expect(screen.getByRole("navigation", { name: "主导航" })).toBeVisible();
});

test("活动头展示由页面提供的摘要，并链接到更多页", () => {
  render(
    <ActivityPageHeader
      activityId="activity-42"
      name="周末露营"
      startDate="2026-08-01"
      endDate="2026-08-03"
      memberCount={3}
      status="ACTIVE"
    />,
  );

  expect(screen.getByRole("heading", { name: "周末露营" })).toBeVisible();
  expect(screen.getByText("3天 · 3人 · 进行中")).toBeVisible();
  expect(screen.getByRole("link", { name: "返回活动列表" })).toHaveAttribute(
    "href",
    "/activities",
  );
  expect(screen.getByRole("link", { name: "活动更多" })).toHaveAttribute(
    "href",
    "/activities/activity-42/more",
  );
  expect(screen.getByRole("navigation", { name: "活动导航" })).toBeVisible();
});

test("活动头的页签在成员、结算和更多页反映当前 URL", () => {
  const { rerender } = render(
    <ActivityPageHeader
      activityId="activity-42"
      name="周末露营"
      startDate={null}
      endDate={null}
      memberCount={3}
      status="ACTIVE"
    />,
  );

  expect(screen.queryByText(/天 ·/)).not.toBeInTheDocument();
  for (const [pathname, label] of [
    ["/activities/activity-42/members", "成员"],
    ["/activities/activity-42/settlements", "结算"],
    ["/activities/activity-42/more", "更多"],
  ]) {
    navigation.pathname = pathname;
    rerender(
      <ActivityPageHeader
        activityId="activity-42"
        name="周末露营"
        startDate={null}
        endDate={null}
        memberCount={3}
        status="ACTIVE"
      />,
    );
    expect(screen.getByRole("link", { name: label })).toHaveAttribute(
      "aria-current",
      "page",
    );
  }
});

test("活动子页面保留全局导航", () => {
  navigation.pathname = "/activities/activity-42/members";
  render(<ProductNavigation />);

  expect(screen.getByRole("navigation", { name: "主导航" })).toBeVisible();
});

test("流水页的活动导航以页签呈现", () => {
  navigation.pathname = "/activities/activity-42";
  render(<ActivityNavigation />);

  const activityNavigation = screen.getByRole("navigation", {
    name: "活动导航",
  });
  expect(activityNavigation).not.toHaveClass("fixed");
  expect(screen.getByRole("link", { name: "流水" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("活动导航以内联页签保留四个深链接和当前项语义", () => {
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
  const activityNavigation = screen.getByRole("navigation", {
    name: "活动导航",
  });
  expect(activityNavigation).not.toHaveClass("fixed", "bottom-0");
  expect(activityNavigation.querySelectorAll("svg")).toHaveLength(0);
  for (const link of screen.getAllByRole("link")) {
    expect(link).toHaveClass("min-h-12", "text-sm");
  }
});
