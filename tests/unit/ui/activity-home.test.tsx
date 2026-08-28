// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { ActivityHome } from "@/features/activities/components/activity-home";

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("活动首页按参考稿呈现紧凑标题、账务摘要和生命周期列表", () => {
  render(
    <ActivityHome
      data={{
        summaries: [
          {
            payableMinor: "3000",
            receivableMinor: "5000",
            currency: "CNY",
          },
        ],
        active: [
          {
            id: "a",
            name: "杭州旅行",
            status: "ACTIVE",
            myNetMinor: "-3000",
          },
        ],
        ended: [
          { id: "b", name: "周末露营", status: "ENDED", myNetMinor: "5000" },
        ],
        archived: [],
      }}
    />,
  );

  expect(screen.getByRole("heading", { name: "活动" })).toBeVisible();
  expect(screen.queryByText("一起花，清楚分。")).not.toBeInTheDocument();

  const summary = screen.getByLabelText("跨活动账务摘要");
  expect(
    within(summary)
      .getAllByRole("term")
      .map((term) => term.textContent),
  ).toEqual(["待支付", "待收款"]);
  expect(summary).toHaveTextContent("待支付¥30.00");
  expect(summary).toHaveTextContent("待收款¥50.00");

  expect(screen.getByRole("heading", { name: "进行中的活动" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "最近结束" })).toBeVisible();
  expect(
    within(screen.getByRole("list", { name: "进行中的活动" })).getByRole(
      "link",
      { name: /杭州旅行/ },
    ),
  ).toBeVisible();
  expect(
    within(screen.getByRole("list", { name: "最近结束" })).getByRole("link", {
      name: /周末露营/,
    }),
  ).toBeVisible();
  expect(screen.getAllByRole("presentation")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "创建活动" })).toHaveAttribute(
    "data-size",
    "icon",
  );
});

test("没有活动时显示可恢复的空状态", () => {
  render(
    <ActivityHome
      data={{ summaries: [], active: [], ended: [], archived: [] }}
    />,
  );

  expect(screen.getByRole("heading", { name: "还没有活动" })).toBeVisible();
  const createActions = screen.getAllByRole("button", { name: "创建活动" });
  expect(createActions).toHaveLength(2);
  expect(
    createActions.find((button) => button.dataset.size === "icon"),
  ).toBeDefined();
  expect(
    createActions.find((button) => button.dataset.size === "default"),
  ).toHaveTextContent("创建活动");
});

test("已结清活动只显示结清状态，不重复显示零金额", () => {
  render(
    <ActivityHome
      data={{
        summaries: [],
        active: [
          {
            id: "settled",
            name: "家庭聚会",
            status: "ACTIVE",
            myNetMinor: "0",
          },
        ],
        ended: [],
        archived: [],
      }}
    />,
  );

  const activityLink = screen.getByRole("link", { name: /家庭聚会/ });
  expect(activityLink).toHaveTextContent("已结清");
  expect(activityLink).not.toHaveTextContent("¥0.00");
});

test("有起止日期时用包含首尾的活动天数压缩列表元数据", () => {
  vi.spyOn(Date, "parse").mockReturnValue(Number.NaN);

  render(
    <ActivityHome
      data={{
        summaries: [],
        active: [
          {
            id: "trip",
            name: "日本大阪之旅",
            location: "大阪",
            startDate: "2026-08-21",
            endDate: "2026-08-25",
            status: "ACTIVE",
            memberCount: 5,
            myNetMinor: "100",
          },
        ],
        ended: [],
        archived: [],
      }}
    />,
  );

  expect(screen.getByRole("link", { name: /日本大阪之旅/ })).toHaveTextContent(
    "5天 · 5人 · 进行中",
  );
});
