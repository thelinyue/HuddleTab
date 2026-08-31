// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { ActivityHome } from "@/features/activities/components/activity-home";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

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
      timeZone="Asia/Shanghai"
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
  expect(
    screen.getByRole("button", { name: "新建或加入活动" }),
  ).toHaveAttribute("data-size", "icon");
});

test("没有活动时用场景插画突出创建入口并弱化加入入口", () => {
  const { container } = render(
    <ActivityHome
      timeZone="Asia/Shanghai"
      data={{ summaries: [], active: [], ended: [], archived: [] }}
    />,
  );

  expect(screen.getByRole("heading", { name: "还没有活动" })).toBeVisible();
  expect(
    screen.getByRole("button", { name: "新建或加入活动" }),
  ).toHaveAttribute("data-size", "icon");
  const createActions = screen.getAllByRole("button", { name: "创建活动" });
  expect(createActions).toHaveLength(1);
  expect(createActions[0]).toHaveAttribute("data-size", "lg");
  expect(createActions[0]).toHaveAttribute("data-variant", "default");
  expect(screen.getByRole("button", { name: "加入已有活动" })).toHaveAttribute(
    "data-variant",
    "link",
  );

  const illustration = container.querySelector(
    'img[src*="activity-list-empty"][alt=""][aria-hidden="true"]',
  );
  expect(illustration).toBeInTheDocument();
  expect(illustration).toHaveAttribute("width", "960");
  expect(illustration).toHaveAttribute("height", "640");
  expect(illustration).toHaveAttribute("loading", "eager");
  expect(illustration).toHaveAttribute(
    "sizes",
    "(max-width: 351px) calc(100vw - 32px), 320px",
  );
});

test("空白态创建和加入入口分别打开对应表单", async () => {
  const user = userEvent.setup();
  const data = { summaries: [], active: [], ended: [], archived: [] };
  render(<ActivityHome data={data} timeZone="Asia/Shanghai" />);

  await user.click(screen.getByRole("button", { name: "创建活动" }));
  expect(screen.getByRole("dialog", { name: "创建活动" })).toBeVisible();

  cleanup();
  render(<ActivityHome data={data} timeZone="Asia/Shanghai" />);
  await user.click(screen.getByRole("button", { name: "加入已有活动" }));
  expect(screen.getByRole("dialog", { name: "加入活动" })).toBeVisible();
});

test("已有活动时不显示空白态插画", () => {
  const { container } = render(
    <ActivityHome
      timeZone="Asia/Shanghai"
      data={{
        summaries: [],
        active: [
          {
            id: "active",
            name: "周末聚餐",
            status: "ACTIVE",
            myNetMinor: "0",
          },
        ],
        ended: [],
        archived: [],
      }}
    />,
  );

  expect(
    container.querySelector('img[src*="activity-list-empty"]'),
  ).not.toBeInTheDocument();
});

test("加号打开新建或加入操作面板，并能切换到两种表单", async () => {
  const user = userEvent.setup();
  const data = { summaries: [], active: [], ended: [], archived: [] };
  render(<ActivityHome data={data} timeZone="Asia/Shanghai" />);

  await user.click(screen.getByRole("button", { name: "新建或加入活动" }));
  const actionDialog = screen.getByRole("dialog", { name: "新建或加入活动" });
  expect(
    within(actionDialog).getByRole("button", { name: "创建活动" }),
  ).toBeVisible();
  expect(
    within(actionDialog).getByRole("button", { name: "加入活动" }),
  ).toBeVisible();
  await user.click(
    within(actionDialog).getByRole("button", { name: "加入活动" }),
  );
  expect(screen.getByRole("dialog", { name: "加入活动" })).toBeVisible();
  expect(screen.getByRole("textbox", { name: "邀请链接" })).toBeVisible();

  cleanup();
  render(<ActivityHome data={data} timeZone="Asia/Shanghai" />);
  await user.click(screen.getByRole("button", { name: "新建或加入活动" }));
  await user.click(
    within(screen.getByRole("dialog", { name: "新建或加入活动" })).getByRole(
      "button",
      { name: "创建活动" },
    ),
  );
  await waitFor(() =>
    expect(screen.getByRole("dialog", { name: "创建活动" })).toBeVisible(),
  );
  expect(screen.getByRole("textbox", { name: "活动名称" })).toBeVisible();
});

test("活动操作与创建/加入共用同一个导航 Overlay，并可返回操作根视图", async () => {
  const user = userEvent.setup();
  render(
    <ActivityHome
      timeZone="Asia/Shanghai"
      data={{ summaries: [], active: [], ended: [], archived: [] }}
    />,
  );

  await user.click(screen.getByRole("button", { name: "新建或加入活动" }));
  const rootDialog = screen.getByRole("dialog", { name: "新建或加入活动" });
  await user.click(
    within(rootDialog).getByRole("button", { name: "创建活动" }),
  );

  const createDialog = screen.getByRole("dialog", { name: "创建活动" });
  expect(createDialog).toBe(rootDialog);
  expect(
    screen.getByRole("button", { name: "返回新建或加入活动" }),
  ).toBeVisible();

  await user.click(screen.getByRole("button", { name: "返回新建或加入活动" }));
  expect(screen.getByRole("dialog", { name: "新建或加入活动" })).toBe(
    rootDialog,
  );
});

test("已结清活动只显示结清状态，不重复显示零金额", () => {
  render(
    <ActivityHome
      timeZone="Asia/Shanghai"
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
      timeZone="Asia/Shanghai"
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
