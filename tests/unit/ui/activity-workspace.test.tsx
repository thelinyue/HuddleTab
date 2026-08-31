// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  activityId: "activity-1",
  memberLoader: vi.fn(),
  query: "",
  router: { back: vi.fn(), replace: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ activityId: mocks.activityId }),
  usePathname: () => `/activities/${mocks.activityId}`,
  useRouter: () => mocks.router,
  useSearchParams: () => new URLSearchParams(mocks.query),
}));
vi.mock("@/features/expenses/components/expense-loaders", () => ({
  ExpenseFeedLoader: ({
    onHeaderData,
  }: {
    readonly onHeaderData?: (data: unknown) => void;
  }) => (
    <>
      <button
        type="button"
        onClick={() =>
          onHeaderData?.({
            activityId: mocks.activityId,
            name: `流水-${mocks.activityId}`,
            startDate: "2026-08-20",
            endDate: "2026-08-22",
            memberCount: 4,
            status: "ACTIVE",
          })
        }
      >
        完成流水头加载
      </button>
      <p data-testid="feed-loader">流水加载器</p>
    </>
  ),
}));
vi.mock("@/features/settlements/components/settlement-page-loader", () => ({
  SettlementPageLoader: ({
    onHeaderData,
  }: {
    readonly onHeaderData?: (data: unknown) => void;
  }) => (
    <>
      <button
        type="button"
        onClick={() =>
          onHeaderData?.({
            activityId: mocks.activityId,
            name: `结算-${mocks.activityId}`,
            startDate: "2026-08-20",
            endDate: "2026-08-22",
            memberCount: 4,
            status: "ACTIVE",
          })
        }
      >
        完成结算头加载
      </button>
      <p data-testid="settlement-loader">结算加载器</p>
    </>
  ),
}));
vi.mock("@/features/members/components/member-page-loader", () => ({
  MemberPageLoader: ({
    open,
    initialView,
  }: {
    readonly open: boolean;
    readonly initialView: "list" | "invite";
  }) => {
    mocks.memberLoader({ open, initialView });
    return open ? <p data-testid="member-loader-view">{initialView}</p> : null;
  },
}));
vi.mock("@/features/activities/components/activity-more", () => ({
  ActivityMore: () => null,
}));
vi.mock("@/features/expenses/components/responsive-form-overlay", () => ({
  ResponsiveFormOverlay: ({ children }: { readonly children: ReactNode }) =>
    children,
}));

import { ActivityWorkspace } from "@/features/activities/components/activity-workspace";

afterEach(() => {
  cleanup();
  mocks.activityId = "activity-1";
  mocks.query = "";
  mocks.router.back.mockReset();
  mocks.router.replace.mockReset();
  vi.clearAllMocks();
});

test("活动工作台以稳定共享 surface 和 Header 承载两个页签", async () => {
  const user = userEvent.setup();
  const { rerender } = render(<ActivityWorkspace timeZone="Asia/Shanghai" />);
  const surface = screen.getByTestId("activity-workspace-surface");

  expect(surface).toHaveClass(
    "bg-workspace",
    "min-h-dvh",
    "flex",
    "flex-col",
    "px-4",
    "pt-[calc(1rem+env(safe-area-inset-top))]",
  );
  expect(surface).toHaveAttribute("data-page-reveal", "false");
  expect(screen.getByTestId("feed-loader")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "完成流水头加载" }));
  const header = screen.getByRole("banner", { name: "活动信息" });
  const settlementTab = screen.getByRole("link", { name: "结算" });
  expect(header).toHaveTextContent("流水-activity-1");

  mocks.query = "?tab=settlement";
  rerender(<ActivityWorkspace timeZone="Asia/Shanghai" />);

  expect(screen.getByTestId("activity-workspace-surface")).toBe(surface);
  expect(screen.getByRole("banner", { name: "活动信息" })).toBe(header);
  expect(screen.getByRole("link", { name: "结算" })).toBe(settlementTab);
  expect(settlementTab).toHaveAttribute("aria-current", "page");
  expect(screen.getByTestId("settlement-loader")).toBeVisible();
});

test("活动 ID 改变时不会短暂展示上一个活动的 Header", async () => {
  const user = userEvent.setup();
  const { rerender } = render(<ActivityWorkspace timeZone="Asia/Shanghai" />);
  await user.click(screen.getByRole("button", { name: "完成流水头加载" }));
  expect(screen.getByRole("heading", { name: "流水-activity-1" })).toBeVisible();

  mocks.activityId = "activity-2";
  mocks.query = "?tab=settlement";
  rerender(<ActivityWorkspace timeZone="Asia/Shanghai" />);

  expect(
    screen.queryByRole("heading", { name: "流水-activity-1" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("banner", { name: "活动信息" })).not.toBeInTheDocument();
});

test("旧邀请参数只被规范化为成员 Sheet 开关，不驱动内部子视图", async () => {
  mocks.query = "?panel=members&invite=1";

  render(<ActivityWorkspace timeZone="Asia/Shanghai" />);

  await waitFor(() =>
    expect(mocks.router.replace).toHaveBeenCalledWith(
      "/activities/activity-1?panel=members",
      { scroll: false },
    ),
  );
});

test("成员面板关闭时不挂载加载器，避免隐藏面板的加载状态泄漏到正文", () => {
  render(<ActivityWorkspace timeZone="Asia/Shanghai" />);

  expect(mocks.memberLoader).not.toHaveBeenCalled();
});

test("成员 Sheet 关闭后再次打开时从成员根视图开始", async () => {
  mocks.query = "?panel=members";
  const { rerender } = render(<ActivityWorkspace timeZone="Asia/Shanghai" />);

  window.dispatchEvent(
    new CustomEvent("huddletab:panel-open", {
      detail: { panel: "members", initialView: "invite" },
    }),
  );
  await waitFor(() =>
    expect(screen.getByTestId("member-loader-view")).toHaveTextContent(
      "invite",
    ),
  );

  mocks.query = "";
  rerender(<ActivityWorkspace timeZone="Asia/Shanghai" />);
  expect(screen.queryByTestId("member-loader-view")).not.toBeInTheDocument();

  mocks.query = "?panel=members";
  rerender(<ActivityWorkspace timeZone="Asia/Shanghai" />);
  expect(screen.getByTestId("member-loader-view")).toHaveTextContent("list");
});
