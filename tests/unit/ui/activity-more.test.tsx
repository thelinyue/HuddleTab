// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  activityId: "activity-1",
  pathname: "/activities/activity-1/more",
}));
const activityHome = vi.hoisted(() => ({ getActivityHome: vi.fn() }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ activityId: navigation.activityId }),
  usePathname: () => navigation.pathname,
}));

vi.mock("@/features/activities/api", () => ({
  getActivityHome: activityHome.getActivityHome,
}));

import { ActivityMore } from "@/features/activities/components/activity-more";

beforeEach(() => {
  activityHome.getActivityHome.mockResolvedValue({
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
  vi.unstubAllGlobals();
  navigation.pathname = "/activities/activity-1/more";
});

test("加载更多页时提供中文状态，完成后顶部更多页签处于选中态", async () => {
  let resolveHome: ((value: unknown) => void) | undefined;
  activityHome.getActivityHome.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveHome = resolve;
    }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          activity: {
            status: "ACTIVE",
            currentMemberRole: "ADMIN",
            currentMemberStatus: "ACTIVE",
          },
        },
      }),
    }),
  );
  render(<ActivityMore />);
  expect(screen.getByRole("status")).toHaveTextContent("正在加载活动信息");
  resolveHome?.({
    summaries: [],
    active: [
      { id: "activity-1", name: "周末露营", status: "ACTIVE", myNetMinor: "0" },
    ],
    ended: [],
    archived: [],
  });
  await screen.findByText("周末露营");
  expect(screen.getAllByRole("link", { name: "更多" })[0]).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("更多页展示当前活动资料，且不显示没有前端契约的入口", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          activity: {
            status: "ACTIVE",
            currentMemberRole: "ADMIN",
            currentMemberStatus: "ACTIVE",
          },
        },
      }),
    }),
  );

  render(<ActivityMore />);

  expect(
    await screen.findByRole("heading", { name: "活动信息" }),
  ).toBeVisible();
  expect(screen.getByText("上海崇明")).toBeVisible();
  expect(screen.getByText("CNY")).toBeVisible();
  expect(screen.getByText("2026-08-20")).toBeVisible();
  expect(screen.getByText("2026-08-22")).toBeVisible();
  expect(screen.queryByText("邀请成员")).not.toBeInTheDocument();
  expect(screen.queryByText("操作记录")).not.toBeInTheDocument();
  expect(screen.queryByText("转让所有权")).not.toBeInTheDocument();
});

test("更多页使用白色产品表面", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          activity: {
            status: "ACTIVE",
            currentMemberRole: "OWNER",
            currentMemberStatus: "ACTIVE",
          },
        },
      }),
    }),
  );

  render(<ActivityMore />);

  await screen.findByRole("heading", { name: "活动信息" });
  expect(screen.getByTestId("activity-more-surface")).toHaveClass("bg-surface");
});

test("活动状态和真实链接使用完整图标提示", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          activity: {
            status: "ACTIVE",
            currentMemberRole: "OWNER",
            currentMemberStatus: "ACTIVE",
          },
        },
      }),
    }),
  );

  render(<ActivityMore />);

  await screen.findByRole("heading", { name: "活动信息" });
  const statusRow = screen.getByText("状态").closest("div");
  expect(statusRow?.querySelector("svg")).not.toBeNull();

  for (const name of ["结算摘要分享", "导出 CSV"]) {
    const link = screen.getByRole("link", { name });
    expect(link).toHaveClass("min-h-12");
    expect(link.querySelector(".rounded-full")).not.toBeNull();
    expect(link.querySelector(".lucide-chevron-right")).not.toBeNull();
  }
});

test("Owner 确认删除活动后调用既有端点并返回活动列表", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      data: {
        activity: {
          status: "ACTIVE",
          currentMemberRole: "OWNER",
          currentMemberStatus: "ACTIVE",
        },
      },
    }),
  });
  const assign = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { assign, origin: "http://localhost" });

  render(<ActivityMore />);

  await user.click(await screen.findByRole("button", { name: "删除活动" }));
  expect(screen.getByRole("alertdialog")).toHaveTextContent("确认删除活动");
  await user.click(screen.getByRole("button", { name: "确认删除" }));
  expect(fetchMock).toHaveBeenLastCalledWith(
    "/api/activities/activity-1/delete",
    {
      method: "POST",
    },
  );
  expect(assign).toHaveBeenCalledWith("http://localhost/activities");
});

test("更多页展示真实摘要、导出和当前生命周期状态", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          activity: {
            status: "ACTIVE",
            currentMemberRole: "ADMIN",
            currentMemberStatus: "ACTIVE",
          },
        },
      }),
    }),
  );

  render(<ActivityMore />);

  expect(await screen.findByText("进行中")).toBeVisible();
  expect(screen.getByRole("link", { name: "结算摘要分享" })).toHaveAttribute(
    "href",
    "/share-summary/activity-1",
  );
  expect(screen.getByRole("link", { name: "导出 CSV" })).toHaveAttribute(
    "href",
    "/api/activities/activity-1/export.csv",
  );
  expect(screen.getByRole("button", { name: "结束活动" })).toBeVisible();
});

test("离线时活动操作提示具有状态语义", async () => {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          activity: {
            status: "ACTIVE",
            currentMemberRole: "OWNER",
            currentMemberStatus: "ACTIVE",
          },
        },
      }),
    }),
  );

  render(<ActivityMore />);

  expect(await screen.findByText("活动操作必须联网后执行。")).toHaveTextContent(
    "活动操作必须联网后执行。",
  );
  expect(screen.getByRole("button", { name: "结束活动" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "删除活动" })).toBeDisabled();
});

test("ACTIVE Admin 不显示删除活动", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          activity: {
            status: "ACTIVE",
            currentMemberRole: "ADMIN",
            currentMemberStatus: "ACTIVE",
          },
        },
      }),
    }),
  );
  render(<ActivityMore />);
  await screen.findByText("进行中");
  expect(
    screen.queryByRole("button", { name: "删除活动" }),
  ).not.toBeInTheDocument();
});

test.each([
  ["ACTIVE Member", "MEMBER", "ACTIVE"],
  ["LEFT Owner", "OWNER", "LEFT"],
] as const)("%s 不显示删除活动", async (_scenario, role, memberStatus) => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          activity: {
            status: "ACTIVE",
            currentMemberRole: role,
            currentMemberStatus: memberStatus,
          },
        },
      }),
    }),
  );

  render(<ActivityMore />);

  await screen.findByText("进行中");
  expect(
    screen.queryByRole("button", { name: "删除活动" }),
  ).not.toBeInTheDocument();
});

test("删除失败不跳转且确认框说明 30 天内可恢复", async () => {
  const user = userEvent.setup();
  const assign = vi.fn();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          activity: {
            status: "ACTIVE",
            currentMemberRole: "OWNER",
            currentMemberStatus: "ACTIVE",
          },
        },
      }),
    })
    .mockResolvedValueOnce({ ok: false });
  vi.stubGlobal("fetch", fetchMock);
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
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          activity: {
            status: "ACTIVE",
            currentMemberRole: "OWNER",
            currentMemberStatus: "ACTIVE",
          },
        },
      }),
    })
    .mockReturnValueOnce(
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
  expect(fetchMock).toHaveBeenCalledTimes(2);
  resolveAction?.({ ok: true });
  expect(await screen.findByRole("status")).toHaveClass("text-success");
});

test("已结束活动只向 Owner 展示归档命令，Admin 仍可恢复活动", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          activity: {
            status: "ENDED",
            currentMemberRole: "ADMIN",
            currentMemberStatus: "ACTIVE",
          },
        },
      }),
    }),
  );

  render(<ActivityMore />);

  expect(await screen.findByRole("button", { name: "恢复活动" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "归档活动" }),
  ).not.toBeInTheDocument();
});

test("已离开活动的 Owner 不显示任何生命周期命令", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          activity: {
            status: "ENDED",
            currentMemberRole: "OWNER",
            currentMemberStatus: "LEFT",
          },
        },
      }),
    }),
  );

  render(<ActivityMore />);

  await screen.findByText("已结束");
  expect(
    screen.queryByRole("heading", { name: "活动操作" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /恢复活动|归档活动/ }),
  ).not.toBeInTheDocument();
});

test("生命周期操作成功后立即使用已知转换刷新状态和命令", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            activity: {
              status: "ACTIVE",
              currentMemberRole: "OWNER",
              currentMemberStatus: "ACTIVE",
            },
          },
        }),
      })
      .mockResolvedValueOnce({ ok: true }),
  );

  render(<ActivityMore />);

  await user.click(await screen.findByRole("button", { name: "结束活动" }));
  expect(await screen.findByText("已结束")).toBeVisible();
  expect(screen.getByRole("button", { name: "恢复活动" })).toBeVisible();
  expect(screen.getByRole("button", { name: "归档活动" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "结束活动" }),
  ).not.toBeInTheDocument();
});

test("生命周期操作失败后保留原状态和原命令", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            activity: {
              status: "ACTIVE",
              currentMemberRole: "OWNER",
              currentMemberStatus: "ACTIVE",
            },
          },
        }),
      })
      .mockResolvedValueOnce({ ok: false }),
  );

  render(<ActivityMore />);

  await user.click(await screen.findByRole("button", { name: "结束活动" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("活动操作未完成");
  expect(screen.getByText("进行中")).toBeVisible();
  expect(screen.getByRole("button", { name: "结束活动" })).toBeVisible();
});
