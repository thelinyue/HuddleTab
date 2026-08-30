// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    scroll,
    ...props
  }: {
    readonly children: ReactNode;
    readonly href: string;
    readonly scroll?: boolean;
  }) => (
    <a
      href={href}
      data-next-scroll={scroll === undefined ? "undefined" : String(scroll)}
      {...props}
    >
      {children}
    </a>
  ),
}));

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
  search: "",
}));
const motion = vi.hoisted(() => ({
  fromTo: vi.fn(),
  registerPlugin: vi.fn(),
  set: vi.fn(),
  to: vi.fn(),
  useGSAP: vi.fn(),
}));
const resize = vi.hoisted(() => ({
  callbacks: [] as ResizeObserverCallback[],
  disconnect: vi.fn(),
  observe: vi.fn(),
}));
vi.mock("@gsap/react", async () => {
  const { useLayoutEffect } =
    await vi.importActual<typeof import("react")>("react");
  return {
    useGSAP: (callback: () => void, config: unknown) => {
      motion.useGSAP(callback, config);
      useLayoutEffect(() => callback());
    },
  };
});
vi.mock("gsap", () => ({
  gsap: {
    fromTo: motion.fromTo,
    registerPlugin: motion.registerPlugin,
    set: motion.set,
    to: motion.to,
  },
}));
vi.mock("gsap/Flip", () => ({ Flip: {} }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ activityId: navigation.activityId }),
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

function setMotionPreference(reducedMotion: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => ({
      addEventListener: vi.fn(),
      matches: reducedMotion,
      removeEventListener: vi.fn(),
    })),
  );
}

function installResizeObserver() {
  class TestResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      resize.callbacks.push(callback);
    }

    disconnect = resize.disconnect;
    observe = resize.observe;
  }
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
}

beforeEach(() => {
  resize.callbacks = [];
  resize.disconnect.mockClear();
  resize.observe.mockClear();
  setMotionPreference(false);
  installResizeObserver();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  navigation.pathname = "/activities";
  navigation.search = "";
});

test("一级导航只有活动、通知、我的，并提供当前项语义", () => {
  render(<BottomNavigation current="activities" unreadCount={3} />);

  expect(screen.getAllByRole("link")).toHaveLength(3);
  expect(screen.getByRole("link", { name: "活动" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByRole("link", { name: /通知，3 条未读/ })).toBeVisible();
  expect(document.querySelector("[data-navigation-indicator]")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
});

test("一级导航切换 current 时在自身范围内定位装饰性指示器", () => {
  const { rerender } = render(
    <BottomNavigation current="activities" unreadCount={0} />,
  );
  rerender(<BottomNavigation current="notifications" unreadCount={0} />);

  expect(motion.to).toHaveBeenCalledWith(
    expect.any(HTMLSpanElement),
    expect.objectContaining({ duration: 0.18, overwrite: "auto", x: 0 }),
  );
  expect(motion.to.mock.calls.some(([, vars]) => "width" in vars)).toBe(false);
  expect(motion.useGSAP).toHaveBeenLastCalledWith(
    expect.any(Function),
    expect.objectContaining({
      revertOnUpdate: false,
      scope: expect.anything(),
    }),
  );
  expect(screen.getByRole("link", { name: "通知" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("减少动态效果时一级导航直接定位装饰性指示器", () => {
  setMotionPreference(true);
  render(<BottomNavigation current="activities" unreadCount={0} />);

  expect(motion.set).toHaveBeenCalledWith(
    expect.any(HTMLSpanElement),
    expect.objectContaining({ x: 0 }),
  );
  expect(motion.to).not.toHaveBeenCalled();
});

test("导航尺寸变化时直接重算 transform，并在卸载时清理观察器", () => {
  const { unmount } = render(
    <BottomNavigation current="activities" unreadCount={0} />,
  );
  const indicator = document.querySelector("[data-navigation-indicator]");
  expect(resize.observe).toHaveBeenCalledWith(expect.any(HTMLElement));

  motion.set.mockClear();
  motion.to.mockClear();
  act(() => resize.callbacks[0]?.([], {} as ResizeObserver));

  expect(motion.set).toHaveBeenCalledWith(indicator, { x: 0 });
  expect(motion.to).not.toHaveBeenCalled();
  expect(motion.set.mock.calls.some(([, vars]) => "width" in vars)).toBe(false);

  unmount();
  expect(resize.disconnect).toHaveBeenCalledTimes(1);
});

test("未读数由零变为正数时仅强调一次通知点", () => {
  const { rerender } = render(
    <BottomNavigation current="activities" unreadCount={0} />,
  );
  rerender(<BottomNavigation current="activities" unreadCount={2} />);
  rerender(<BottomNavigation current="activities" unreadCount={3} />);

  expect(
    motion.fromTo.mock.calls.filter(
      ([target]) =>
        target instanceof HTMLElement &&
        target.hasAttribute("data-unread-indicator"),
    ),
  ).toHaveLength(1);
  expect(
    screen
      .getByLabelText("通知，3 条未读")
      .querySelector("[data-unread-indicator]"),
  ).toHaveAttribute("aria-hidden", "true");
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

test("活动工作台隐藏全局导航", () => {
  navigation.pathname = "/activities/activity-42";
  render(<ProductNavigation />);

  expect(
    screen.queryByRole("navigation", { name: "主导航" }),
  ).not.toBeInTheDocument();
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
  expect(screen.getByRole("banner", { name: "活动信息" })).toHaveTextContent(
    "3天 · 3人 · 进行中",
  );
  expect(screen.getByRole("link", { name: "查看成员，3人" })).toBeVisible();
  expect(screen.getByRole("link", { name: "返回活动列表" })).toHaveAttribute(
    "href",
    "/activities",
  );
  expect(screen.getByRole("link", { name: "活动更多" })).toHaveAttribute(
    "href",
    "/activities/activity-42?panel=manage",
  );
  expect(screen.getByRole("navigation", { name: "活动导航" })).toBeVisible();
});

test("活动头的页签只保留流水与结算，并反映 query URL", () => {
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
  for (const [pathname, search, label] of [
    ["/activities/activity-42", "", "流水"],
    ["/activities/activity-42", "?tab=settlement", "结算"],
  ]) {
    navigation.pathname = pathname;
    navigation.search = search;
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

test("活动子页面隐藏全局导航", () => {
  navigation.pathname = "/activities/activity-42/members";
  render(<ProductNavigation />);

  expect(
    screen.queryByRole("navigation", { name: "主导航" }),
  ).not.toBeInTheDocument();
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

test("活动导航以内联页签保留两个工作台链接和当前项语义", () => {
  navigation.pathname = "/activities/activity-42";
  navigation.search = "?tab=settlement";
  render(<ActivityNavigation />);

  expect(screen.getAllByRole("link")).toHaveLength(2);
  expect(screen.getByRole("link", { name: "流水" })).toHaveAttribute(
    "href",
    "/activities/activity-42",
  );
  expect(screen.getByRole("link", { name: "结算" })).toHaveAttribute(
    "href",
    "/activities/activity-42?tab=settlement",
  );
  for (const link of screen.getAllByRole("link")) {
    expect(link).toHaveAttribute("data-next-scroll", "false");
  }
  const activityNavigation = screen.getByRole("navigation", {
    name: "活动导航",
  });
  expect(activityNavigation).not.toHaveClass("fixed", "bottom-0");
  expect(activityNavigation.querySelectorAll("svg")).toHaveLength(0);
  expect(
    activityNavigation.querySelector("[data-navigation-indicator]"),
  ).toHaveAttribute("aria-hidden", "true");
  for (const link of screen.getAllByRole("link")) {
    expect(link).toHaveClass("min-h-12", "text-sm");
  }
});

test("活动导航切换 pathname 时在自身范围内过渡装饰性指示器", () => {
  navigation.pathname = "/activities/activity-42";
  const { rerender } = render(<ActivityNavigation />);
  navigation.search = "?tab=settlement";
  rerender(<ActivityNavigation />);

  expect(motion.to).toHaveBeenCalledWith(
    expect.any(HTMLSpanElement),
    expect.objectContaining({ duration: 0.18, overwrite: "auto", x: 0 }),
  );
  expect(screen.getByRole("link", { name: "结算" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});
