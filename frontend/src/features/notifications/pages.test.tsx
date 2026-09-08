import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  clear: { error: null as unknown, isPending: false, mutateAsync: vi.fn() },
  decide: { error: null as unknown, isPending: false, mutateAsync: vi.fn() },
  delete: { error: null as unknown, isPending: false, mutateAsync: vi.fn(), variables: undefined as string | undefined },
  markAllRead: { error: null as unknown, isPending: false, mutateAsync: vi.fn() },
  markRead: { error: null as unknown, isPending: false, mutateAsync: vi.fn() },
  notifications: { items: [] as Array<Record<string, unknown>>, unreadCount: 1, timeZone: "Asia/Shanghai" },
}));

vi.mock("../auth/api", () => ({
  useSessionQuery: () => ({
    data: { displayName: "Alice", userId: "user-1", username: "alice" },
    isPending: false,
  }),
}));
vi.mock("./api", () => ({
  useClearNotificationsMutation: () => state.clear,
  useDecideNotificationJoinRequestMutation: () => state.decide,
  useDeleteNotificationMutation: () => state.delete,
  useMarkAllNotificationsReadMutation: () => state.markAllRead,
  useMarkNotificationReadMutation: () => state.markRead,
  useNotificationsQuery: () => ({
    data: state.notifications,
    isPending: false,
  }),
}));

import {
  notificationDestination,
  notificationSwipeShouldOpen,
  NotificationsPage,
  NotificationsSummary,
  projectNotificationSwipe,
} from "./pages";
import type { Notification } from "./api";

function notification(overrides: Partial<Notification> = {}): Notification {
  return {
    activityId: "activity-safe",
    activityDeleted: false,
    createdAt: "2026-09-01T10:00:00Z",
    kind: "JOIN_APPROVAL_REQUESTED",
    notificationId: "notification-1",
    payload: { displayName: "Bob", status: "APPROVED", url: "/untrusted" },
    readAt: null,
    targetId: "activity-safe",
    targetType: "ACTIVITY",
    ...overrides,
  };
}

function openPageMenu() {
  fireEvent.pointerDown(screen.getByRole("button", { name: "通知更多操作" }), { button: 0, ctrlKey: false });
  return screen.getByRole("menu");
}

function openRowMenu(notificationId = "notification-1") {
  const row = screen.getByTestId(`notification-${notificationId}`);
  fireEvent.pointerDown(within(row).getByRole("button", { name: "通知操作" }), { button: 0, ctrlKey: false });
  return screen.getByRole("menu");
}

afterEach(() => {
  cleanup();
  state.clear.error = null;
  state.clear.isPending = false;
  state.clear.mutateAsync.mockReset();
  state.markRead.error = null;
  state.markRead.isPending = false;
  state.markRead.mutateAsync.mockReset();
  state.markAllRead.error = null;
  state.markAllRead.isPending = false;
  state.markAllRead.mutateAsync.mockReset();
  state.delete.error = null;
  state.delete.isPending = false;
  state.delete.variables = undefined;
  state.delete.mutateAsync.mockReset();
  state.decide.error = null;
  state.decide.isPending = false;
  state.decide.mutateAsync.mockReset();
  state.notifications.items = [notification()];
  state.notifications.unreadCount = 1;
});

describe("NotificationsPage", () => {
  it.each([
    "JOIN_APPROVAL_REQUESTED",
    "JOIN_APPROVAL_RESOLVED",
    "MEMBER_JOINED",
    "PARTICIPATING_EXPENSE_CHANGED",
    "PARTICIPATING_EXPENSE_DELETED",
    "SETTLEMENT_RECEIVED",
    "ACTIVITY_STATUS_CHANGED",
    "OWNERSHIP_CHANGED",
  ] as Notification["kind"][]) ("已删除活动的 %s 通知不可跳转", (kind) => {
    const current = notification({
      activityDeleted: true,
      kind,
      payload: kind === "JOIN_APPROVAL_REQUESTED"
        ? { displayName: "Bob", requestId: "request-1" }
        : { activityName: "旅行", status: "ENDED" },
    });
    state.notifications.items = [current];
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);

    const row = screen.getByTestId("notification-notification-1");
    expect(notificationDestination(current)).toBeUndefined();
    expect(row.querySelector("a")).toBeNull();
    expect(row).toHaveTextContent("活动已删除，无法打开");
    expect(row.querySelector("button[aria-label='标记通知为已读']")).toBeInTheDocument();
    if (kind === "JOIN_APPROVAL_REQUESTED") {
      expect(screen.queryByRole("button", { name: "通过" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "拒绝" })).not.toBeInTheDocument();
    }
  });

  it("通知链接只使用受控 activityId，不信任 payload URL", () => {
    state.notifications.items = [notification()];
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);

    expect(screen.getByRole("link", { name: /Bob 申请加入活动/ })).toHaveAttribute(
      "href",
      "/activities/activity-safe?panel=members",
    );
    expect(screen.queryByRole("link", { name: /Bob 申请加入活动/ })).not.toHaveAttribute(
      "href",
      "/untrusted",
    );
  });

  it("活动恢复后删除状态通知重新生成活动链接", () => {
    const restored = notification({
      activityDeleted: false,
      kind: "ACTIVITY_STATUS_CHANGED",
      payload: { activityName: "旅行", status: "DELETED" },
    });

    expect(notificationDestination(restored)).toBe("/activities/activity-safe");
  });

  it("已读失败保留未读外观并显示错误", async () => {
    state.notifications.items = [notification()];
    state.markRead.mutateAsync.mockRejectedValue(new Error("通知更新失败"));
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);
    const row = screen.getByTestId("notification-notification-1");

    fireEvent.click(within(openRowMenu()).getByRole("menuitem", { name: "标为已读" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("通知更新失败");
    expect(row).toHaveAttribute("data-unread", "true");
  });

  it("按邀请、结算和系统筛选，并为结算构造受控深链", () => {
    state.notifications.items = [
      notification(),
      notification({ kind: "SETTLEMENT_RECEIVED", notificationId: "notification-2", payload: { amountMinor: "1200", currency: "CNY" }, targetId: "settlement-1" }),
      notification({ kind: "ACTIVITY_STATUS_CHANGED", notificationId: "notification-3", payload: { activityName: "旅行", status: "ENDED" } }),
    ];
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: "结算" }));
    expect(screen.getByRole("link", { name: /收到一笔结算/ })).toHaveAttribute("href", "/activities/activity-safe?tab=settlement");
    expect(screen.queryByText(/Bob 申请加入活动/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "系统" }));
    expect(screen.getByText("活动状态已更新")).toBeInTheDocument();
  });

  it("加入申请可在通知内通过，失败时仍保留操作", async () => {
    state.notifications.items = [notification({ payload: { displayName: "Bob", requestId: "request-1" } })];
    state.decide.mutateAsync.mockRejectedValue(new Error("审批失败"));
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: "通过" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("审批失败");
    expect(state.decide.mutateAsync).toHaveBeenCalledWith({ activityId: "activity-safe", requestId: "request-1", decision: "APPROVE" });
    expect(screen.getByRole("button", { name: "通过" })).toBeInTheDocument();
  });

  it("按是否存在审批动作标记通知行布局", () => {
    state.notifications.items = [
      notification({ payload: { displayName: "Bob", requestId: "request-1" } }),
      notification({
        kind: "SETTLEMENT_RECEIVED",
        notificationId: "notification-2",
        payload: { amountMinor: "1200", currency: "CNY" },
        targetId: "settlement-1",
      }),
    ];
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);

    expect(screen.getByTestId("notification-notification-1")).toHaveAttribute(
      "data-actionable",
      "true",
    );
    expect(screen.getByTestId("notification-notification-2")).toHaveAttribute(
      "data-actionable",
      "false",
    );
    expect(
      within(openRowMenu("notification-2")).getByRole(
        "menuitem",
        { name: "删除" },
      ),
    ).toBeInTheDocument();
  });

  it("全部已读只调用一次服务端批量接口", async () => {
    state.notifications.items = [notification(), notification({ notificationId: "notification-2" })];
    state.notifications.unreadCount = 2;
    state.markAllRead.mutateAsync.mockResolvedValue(undefined);
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: /全部已读/ }));
    await waitFor(() => expect(state.markAllRead.mutateAsync).toHaveBeenCalledTimes(1));
    expect(state.markRead.mutateAsync).not.toHaveBeenCalled();
  });

  it("已读的待审批通知仍保留审批操作", () => {
    state.notifications.items = [notification({ readAt: "2026-09-08T00:00:00Z", payload: { displayName: "Bob", requestId: "request-1" } })];
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "通过" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "拒绝" })).toBeInTheDocument();
  });

  it("状态为待处理的审批通知保留审批操作", () => {
    state.notifications.items = [notification({ payload: { displayName: "Bob", requestId: "request-1", status: "PENDING" } })];
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "通过" })).toBeInTheDocument();
  });

  it("按当前筛选确认清理并发送筛选值", async () => {
    state.notifications.items = [notification({ kind: "ACTIVITY_STATUS_CHANGED", payload: { activityName: "旅行", status: "ENDED" } })];
    state.clear.mutateAsync.mockResolvedValue(undefined);
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: "系统" }));
    fireEvent.click(within(openPageMenu()).getByRole("menuitem", { name: "清理当前" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("系统");
    expect(screen.getByRole("alertdialog")).toHaveTextContent("当前列表未加载的旧通知");
    fireEvent.click(screen.getByRole("button", { name: "确认清理" }));

    await waitFor(() => expect(state.clear.mutateAsync).toHaveBeenCalledWith("SYSTEM"));
  });

  it("取消清理不发送请求，单条删除直接发送通知 ID", async () => {
    state.delete.mutateAsync.mockResolvedValue(undefined);
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);

    fireEvent.click(within(openPageMenu()).getByRole("menuitem", { name: "清理当前" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(state.clear.mutateAsync).not.toHaveBeenCalled();

    fireEvent.click(within(openRowMenu()).getByRole("menuitem", { name: "删除" }));
    await waitFor(() => expect(state.delete.mutateAsync).toHaveBeenCalledWith("notification-1"));
  });

  it("清理失败保留原列表并在确认框显示错误", async () => {
    state.clear.mutateAsync.mockRejectedValue(new Error("清理失败"));
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);

    fireEvent.click(within(openPageMenu()).getByRole("menuitem", { name: "清理当前" }));
    fireEvent.click(screen.getByRole("button", { name: "确认清理" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("清理失败");
    expect(screen.getByTestId("notification-notification-1")).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("待审批通知可以无确认直接删除", async () => {
    state.notifications.items = [notification({ payload: { displayName: "Bob", requestId: "request-1" } })];
    state.delete.mutateAsync.mockResolvedValue(undefined);
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);

    expect(screen.getByRole("button", { name: "通过" })).toBeInTheDocument();
    fireEvent.click(within(openRowMenu()).getByRole("menuitem", { name: "删除" }));
    await waitFor(() => expect(state.delete.mutateAsync).toHaveBeenCalledWith("notification-1"));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

describe("通知摘要与滑动交互", () => {
  it("按待决审批、其他未读、最新已读排序并最多显示五条", () => {
    state.notifications.items = [
      notification({
        notificationId: "read-old",
        kind: "ACTIVITY_STATUS_CHANGED",
        createdAt: "2026-09-01T08:00:00Z",
        readAt: "2026-09-01T09:00:00Z",
        payload: { activityName: "旧活动", status: "ENDED" },
      }),
      notification({
        notificationId: "unread-old",
        kind: "SETTLEMENT_RECEIVED",
        createdAt: "2026-09-03T08:00:00Z",
        payload: { amountMinor: "1200", currency: "CNY" },
      }),
      notification({
        notificationId: "pending-old",
        createdAt: "2026-09-02T08:00:00Z",
        readAt: "2026-09-02T09:00:00Z",
        payload: { displayName: "待处理旧申请", requestId: "request-old", status: "PENDING" },
      }),
      notification({
        notificationId: "pending-new",
        createdAt: "2026-09-04T08:00:00Z",
        payload: { displayName: "待处理新申请", requestId: "request-new", status: "PENDING" },
      }),
      notification({
        notificationId: "unread-new",
        kind: "ACTIVITY_STATUS_CHANGED",
        createdAt: "2026-09-05T08:00:00Z",
        payload: { activityName: "最新活动", status: "ENDED" },
      }),
      notification({
        notificationId: "read-new",
        kind: "MEMBER_JOINED",
        createdAt: "2026-09-06T08:00:00Z",
        readAt: "2026-09-06T09:00:00Z",
        payload: { displayName: "已读成员", activityName: "活动" },
      }),
      notification({
        notificationId: "read-extra",
        kind: "OWNERSHIP_CHANGED",
        createdAt: "2026-09-07T08:00:00Z",
        readAt: "2026-09-07T09:00:00Z",
        payload: { activityName: "超出摘要" },
      }),
    ];

    render(<MemoryRouter><NotificationsSummary onViewAll={vi.fn()} /></MemoryRouter>);

    expect(screen.getAllByRole("article")).toHaveLength(5);
    expect(screen.getAllByRole("article").map((row) => row.getAttribute("data-testid"))).toEqual([
      "notification-pending-new",
      "notification-pending-old",
      "notification-unread-new",
      "notification-unread-old",
      "notification-read-extra",
    ]);
  });

  it("摘要通过查看全部回调进入完整通知页", () => {
    const onViewAll = vi.fn();
    render(<MemoryRouter><NotificationsSummary onViewAll={onViewAll} /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: /查看全部通知/ }));
    expect(onViewAll).toHaveBeenCalledTimes(1);
  });

  it("滑动使用十像素迟滞、投影速度和操作区阈值", () => {
    expect(projectNotificationSwipe(-20, -300)).toBe(-74);
    expect(notificationSwipeShouldOpen(-20, 128, -300)).toBe(true);
    expect(notificationSwipeShouldOpen(-40, 128, 0)).toBe(false);
    expect(notificationSwipeShouldOpen(0, 128, -600)).toBe(true);
  });

  it("同一列表只展开一行，并抑制拖动结束后的误点击", () => {
    state.notifications.items = [
      notification({ notificationId: "notification-1" }),
      notification({ notificationId: "notification-2", kind: "ACTIVITY_STATUS_CHANGED", payload: { activityName: "第二条", status: "ENDED" } }),
    ];
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);

    const firstSurface = screen.getByTestId("notification-notification-1").querySelector<HTMLElement>(".notification-row__surface")!;
    fireEvent.pointerDown(firstSurface, { pointerId: 1, pointerType: "touch", clientX: 220, clientY: 20, button: 0 });
    fireEvent.pointerMove(firstSurface, { pointerId: 1, pointerType: "touch", clientX: 100, clientY: 20 });
    fireEvent.pointerUp(firstSurface, { pointerId: 1, pointerType: "touch", clientX: 100, clientY: 20 });
    expect(screen.getByTestId("notification-notification-1")).toHaveAttribute("data-swipe-open", "true");

    const secondSurface = screen.getByTestId("notification-notification-2").querySelector<HTMLElement>(".notification-row__surface")!;
    fireEvent.pointerDown(secondSurface, { pointerId: 2, pointerType: "touch", clientX: 220, clientY: 20, button: 0 });
    fireEvent.pointerMove(secondSurface, { pointerId: 2, pointerType: "touch", clientX: 100, clientY: 20 });
    fireEvent.pointerUp(secondSurface, { pointerId: 2, pointerType: "touch", clientX: 100, clientY: 20 });
    expect(screen.getByTestId("notification-notification-2")).toHaveAttribute("data-swipe-open", "true");
    expect(screen.getByTestId("notification-notification-1")).toHaveAttribute("data-swipe-open", "false");
  });
});
