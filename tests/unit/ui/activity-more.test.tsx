// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const navigation = vi.hoisted(() => ({ activityId: "activity-1" }));
const api = vi.hoisted(() => ({
  getActivityDetails: vi.fn(),
  getActivityHome: vi.fn(),
  updateActivityDetails: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ activityId: navigation.activityId }),
  usePathname: () => `/activities/${navigation.activityId}/more`,
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/features/activities/api", () => api);

import { ActivityMore } from "@/features/activities/components/activity-more";

function details(
  overrides: Partial<Awaited<ReturnType<typeof api.getActivityDetails>>> = {},
) {
  return {
    id: "activity-1",
    name: "周末露营",
    location: "上海崇明",
    baseCurrency: "CNY",
    startDate: "2026-08-20",
    endDate: "2026-08-22",
    status: "ACTIVE",
    revision: "1",
    currentMemberRole: "OWNER",
    currentMemberStatus: "ACTIVE",
    hasAccountingRecords: false,
    earliestExpenseDate: null,
    permissions: {
      name: true,
      location: true,
      baseCurrency: true,
      startDate: true,
      endDate: true,
    },
    ...overrides,
  };
}

beforeEach(() => {
  api.getActivityDetails.mockResolvedValue(details());
  api.getActivityHome.mockResolvedValue({
    summaries: [],
    active: [
      {
        id: "activity-1",
        name: "周末露营",
        location: "上海崇明",
        baseCurrency: "CNY",
        startDate: "2026-08-20",
        endDate: "2026-08-22",
        status: "ACTIVE",
        memberCount: 4,
        myNetMinor: "0",
      },
    ],
    ended: [],
    archived: [],
  });
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

test("加载活动管理页时提供中文状态，顶部只保留流水和结算页签", async () => {
  let resolveDetails: ((value: ReturnType<typeof details>) => void) | undefined;
  api.getActivityDetails.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveDetails = resolve;
    }),
  );
  render(<ActivityMore />);
  expect(screen.getByRole("status")).toHaveTextContent("正在加载活动信息");

  resolveDetails?.(details());
  await screen.findByRole("heading", { name: "周末露营", level: 1 });
  expect(screen.getByRole("link", { name: "流水" })).toBeVisible();
  expect(screen.getByRole("link", { name: "结算" })).toBeVisible();
  expect(screen.queryByRole("link", { name: "更多" })).not.toBeInTheDocument();
});

test("更多页展示活动资料和真实链接，不显示没有前端契约的入口", async () => {
  render(<ActivityMore />);

  expect(await screen.findByRole("heading", { name: "活动信息" })).toBeVisible();
  expect(screen.getByText("上海崇明")).toBeVisible();
  expect(screen.getByText("CNY · 人民币")).toBeVisible();
  expect(screen.getByText("2026-08-20")).toBeVisible();
  expect(screen.getByText("2026-08-22")).toBeVisible();
  expect(screen.getByRole("link", { name: "结算摘要分享" })).toHaveAttribute(
    "href",
    "/share-summary/activity-1",
  );
  expect(screen.getByRole("link", { name: "导出 CSV" })).toHaveAttribute(
    "href",
    "/api/activities/activity-1/export.csv",
  );
  for (const label of ["邀请成员", "操作记录", "转让所有权"]) {
    expect(screen.queryByText(label)).not.toBeInTheDocument();
  }
});

test("更多页保持产品表面、完整状态图标和 44px 链接入口", async () => {
  render(<ActivityMore />);
  await screen.findByRole("heading", { name: "活动信息" });

  expect(screen.getByTestId("activity-more-surface")).toHaveClass("bg-surface");
  expect(screen.getByText("状态").closest("div")?.querySelector("svg")).not.toBeNull();
  for (const name of ["结算摘要分享", "导出 CSV"]) {
    const link = screen.getByRole("link", { name });
    expect(link).toHaveClass("min-h-12");
    expect(link.querySelector(".rounded-full")).not.toBeNull();
    expect(link.querySelector(".lucide-chevron-right")).not.toBeNull();
  }
});

test("Owner 确认删除活动后调用既有端点并返回活动列表", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn().mockResolvedValue({ ok: true });
  const assign = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { assign, origin: "http://localhost" });
  render(<ActivityMore />);

  await user.click(await screen.findByRole("button", { name: "删除活动" }));
  expect(screen.getByRole("alertdialog")).toHaveTextContent("确认删除活动");
  await user.click(screen.getByRole("button", { name: "确认删除" }));
  expect(fetchMock).toHaveBeenLastCalledWith(
    "/api/activities/activity-1/delete",
    { method: "POST" },
  );
  expect(assign).toHaveBeenCalledWith("http://localhost/activities");
});

test("离线时生命周期和删除操作均禁用", async () => {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
  render(<ActivityMore />);

  expect(await screen.findByText("活动操作必须联网后执行。")).toBeVisible();
  expect(screen.getByRole("button", { name: "结束活动" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "删除活动" })).toBeDisabled();
});

test.each([
  ["ACTIVE Admin", "ADMIN", "ACTIVE"],
  ["ACTIVE Member", "MEMBER", "ACTIVE"],
  ["LEFT Owner", "OWNER", "LEFT"],
] as const)("%s 不显示删除活动", async (_scenario, role, memberStatus) => {
  api.getActivityDetails.mockResolvedValue(
    details({ currentMemberRole: role, currentMemberStatus: memberStatus }),
  );
  render(<ActivityMore />);

  await screen.findByText("进行中");
  expect(screen.queryByRole("button", { name: "删除活动" })).not.toBeInTheDocument();
});

test("删除失败不跳转且确认框说明 30 天内可恢复", async () => {
  const user = userEvent.setup();
  const assign = vi.fn();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
  vi.stubGlobal("location", { assign, origin: "http://localhost" });
  render(<ActivityMore />);

  await user.click(await screen.findByRole("button", { name: "删除活动" }));
  expect(screen.getByRole("alertdialog")).toHaveTextContent("30 天内可恢复");
  await user.click(screen.getByRole("button", { name: "确认删除" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("删除活动未完成");
  expect(assign).not.toHaveBeenCalled();
});

test("生命周期命令进行中禁用重复提交，成功消息使用正常语义色", async () => {
  const user = userEvent.setup();
  let resolveAction: ((value: unknown) => void) | undefined;
  const fetchMock = vi.fn().mockReturnValueOnce(
    new Promise((resolve) => {
      resolveAction = resolve;
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(<ActivityMore />);

  const end = await screen.findByRole("button", { name: "结束活动" });
  await user.click(end);
  expect(end).toBeDisabled();
  await user.click(end);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  resolveAction?.({ ok: true });
  expect(await screen.findByRole("status")).toHaveClass("text-success");
});

test("已结束活动只向 Owner 展示归档命令，Admin 仍可恢复活动", async () => {
  api.getActivityDetails.mockResolvedValue(
    details({ status: "ENDED", currentMemberRole: "ADMIN" }),
  );
  render(<ActivityMore />);

  expect(await screen.findByRole("button", { name: "恢复活动" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "归档活动" })).not.toBeInTheDocument();
});

test("已离开活动的 Owner 不显示任何生命周期命令", async () => {
  api.getActivityDetails.mockResolvedValue(
    details({ status: "ENDED", currentMemberStatus: "LEFT" }),
  );
  render(<ActivityMore />);

  await screen.findByText("已结束");
  expect(
    screen.queryByRole("button", { name: /恢复活动|归档活动/ }),
  ).not.toBeInTheDocument();
});

test("生命周期操作成功后重新获取详情和字段权限", async () => {
  const user = userEvent.setup();
  api.getActivityDetails
    .mockResolvedValueOnce(details())
    .mockResolvedValueOnce(
      details({
        status: "ENDED",
        permissions: {
          name: true,
          location: true,
          baseCurrency: false,
          startDate: false,
          endDate: false,
        },
      }),
    );
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  render(<ActivityMore />);

  await user.click(await screen.findByRole("button", { name: "结束活动" }));
  expect(await screen.findByText("已结束")).toBeVisible();
  expect(api.getActivityDetails).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("button", { name: "恢复活动" })).toBeVisible();
  expect(screen.getByRole("button", { name: "归档活动" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "编辑开始日期" })).not.toBeInTheDocument();
});

test("生命周期操作失败后保留原状态和原命令", async () => {
  const user = userEvent.setup();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
  render(<ActivityMore />);

  await user.click(await screen.findByRole("button", { name: "结束活动" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("活动操作未完成");
  expect(screen.getByText("进行中")).toBeVisible();
  expect(screen.getByRole("button", { name: "结束活动" })).toBeVisible();
});
