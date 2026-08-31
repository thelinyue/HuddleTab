// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useParams: () => ({ activityId: "activity-1" }),
  usePathname: () => "/activities/activity-1",
  useSearchParams: () => new URLSearchParams("?tab=settlement"),
}));

import { SettlementPage } from "@/features/settlements/components/settlement-page";

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const data = {
  activity: {
    id: "activity-1",
    name: "大阪旅行",
    currency: "CNY",
    status: "ACTIVE" as const,
    currentMemberId: "m1",
    currentMemberStatus: "ACTIVE" as const,
    currentMemberRole: "MEMBER" as const,
  },
  summary: {
    activityName: "大阪旅行",
    startDate: "2026-08-20",
    endDate: "2026-08-24",
    memberCount: 2,
  },
  members: [
    {
      id: "m1",
      displayName: "小王",
      status: "ACTIVE" as const,
      avatarPreset: 2 as const,
    },
    {
      id: "m2",
      displayName: "小李",
      status: "ACTIVE" as const,
      avatarPreset: 5 as const,
    },
  ],
  balances: [
    { memberId: "m1", netMinor: "-32650" },
    { memberId: "m2", netMinor: "32650" },
  ],
  recommendations: [
    { payerMemberId: "m1", receiverMemberId: "m2", amountMinor: "32650" },
  ],
  settlements: [],
};

const settlement = {
  id: "s1",
  payerMemberId: "m1",
  receiverMemberId: "m2",
  amountMinor: "32650",
  currency: "CNY",
  occurredAt: "2026-08-27T08:00:00.000Z",
  note: "已转账",
};

test("结算信息按我的结算、推荐、记录和操作顺序展示", () => {
  render(
    <SettlementPage
      data={{ ...data, settlements: [settlement] }}
      timeZone="Asia/Shanghai"
      createSettlement={vi.fn()}
    />,
  );

  expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  expect(screen.getByTestId("settlement-page-content")).toHaveClass(
    "flex",
    "flex-1",
    "flex-col",
  );
  expect(screen.getByRole("main")).toHaveClass("flex", "flex-1", "flex-col");
  const summary = screen.getByLabelText("结算摘要");
  expect(summary).toHaveClass("bg-summary", "rounded-sm", "px-4", "py-4");
  expect(within(summary).getByLabelText("我的结算")).toHaveTextContent(
    "应付¥326.50",
  );
  expect(within(summary).getByText("¥326.50")).toHaveClass(
    "type-display-amount",
    "money",
  );
  expect(within(summary).getByText("1 人未结清 · 0 人已结清")).toBeVisible();
  expect(screen.getByRole("button", { name: /成员余额/ })).toBeVisible();
  expect(screen.getByRole("heading", { name: "推荐转账" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "实际结算记录" })).toBeVisible();
  expect(screen.getByRole("list", { name: "推荐转账" })).toBeVisible();
  expect(screen.getByRole("list", { name: "实际结算记录" })).toBeVisible();
  expect(screen.getByText("已转账")).toBeVisible();
  expect(screen.getByText(/2026年8月27日 16:00/)).toBeVisible();
  expect(screen.getByRole("button", { name: "补记结算" })).toBeVisible();
  expect(screen.getAllByRole("button", { name: "记录结算" })).toHaveLength(1);
  expect(
    screen.queryByRole("banner", { name: "活动信息" }),
  ).not.toBeInTheDocument();
});

test("四人活动全部归零时只统计当前用户之外的三人，并展示明确完成态", () => {
  render(
    <SettlementPage
      data={{
        ...data,
        summary: { ...data.summary, memberCount: 4 },
        members: [
          ...data.members,
          { id: "m3", displayName: "小周", status: "ACTIVE" },
          { id: "m4", displayName: "小陈", status: "ACTIVE" },
        ],
        balances: ["m1", "m2", "m3", "m4"].map((memberId) => ({
          memberId,
          netMinor: "0",
        })),
        recommendations: [],
      }}
      timeZone="Asia/Shanghai"
      createSettlement={vi.fn()}
    />,
  );

  expect(
    within(screen.getByLabelText("结算摘要")).getByText(
      "0 人未结清 · 3 人已结清",
    ),
  ).toBeVisible();
  expect(screen.getByText("当前无需转账")).toBeVisible();
  expect(screen.getByText("所有成员余额均已结清")).toBeVisible();
  const completedAction = screen.getByRole("button", { name: "全部已结清" });
  expect(completedAction).toBeDisabled();
  expect(completedAction).toHaveClass("text-success");
  expect(completedAction.querySelector(".lucide-check")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "补记结算" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "记录结算" }),
  ).not.toBeInTheDocument();
});

test("推荐转账整行预填结算，不显示重复操作文案", async () => {
  const user = userEvent.setup();
  const createSettlement = vi.fn();
  render(
    <SettlementPage
      data={data}
      timeZone="Asia/Shanghai"
      createSettlement={createSettlement}
    />,
  );

  const recommendation = screen.getByRole("button", {
    name: "按建议记录：小王向小李支付 ¥326.50",
  });
  expect(recommendation).toHaveClass("min-h-16");
  expect(recommendation).toHaveTextContent("小王小李¥326.50待结清");
  expect(
    within(recommendation).getByTestId("recommendation-chevron"),
  ).toBeVisible();
  expect(screen.queryByText("按建议记录")).not.toBeInTheDocument();

  await user.click(recommendation);
  expect(screen.getByLabelText("付款人")).toHaveValue("m1");
  expect(screen.getByLabelText("收款人")).toHaveValue("m2");
  expect(screen.getByLabelText("金额")).toHaveValue("326.50");
  expect(createSettlement).not.toHaveBeenCalled();
});

test("结算正文不重复工作台拥有的活动导航", () => {
  render(
    <SettlementPage
      data={data}
      timeZone="Asia/Shanghai"
      createSettlement={vi.fn()}
    />,
  );

  expect(
    screen.queryByRole("navigation", { name: "活动导航" }),
  ).not.toBeInTheDocument();
});

test("成员余额作为二级入口打开，并使用头像、方向文字和绝对值金额", async () => {
  const user = userEvent.setup();
  render(
    <SettlementPage
      data={{
        ...data,
        balances: [...data.balances, { memberId: "m3", netMinor: "0" }],
        members: [
          ...data.members,
          { id: "m3", displayName: "小周", status: "ACTIVE" },
        ],
      }}
      timeZone="Asia/Shanghai"
      createSettlement={vi.fn()}
    />,
  );

  const balanceEntry = screen.getByRole("button", { name: /成员余额/ });
  expect(balanceEntry).toHaveTextContent("1 人应收 · 0 人应付");
  await user.click(balanceEntry);
  const balances = within(
    screen.getByRole("dialog", { name: "成员余额" }),
  ).getByRole("list", { name: "成员余额" });
  expect(within(balances).getByText("小王").closest("li")).toHaveTextContent(
    "应付¥326.50",
  );
  expect(within(balances).getByText("小李").closest("li")).toHaveTextContent(
    "应收¥326.50",
  );
  const settledRow = within(balances).getByText("小周").closest("li");
  expect(settledRow).toHaveTextContent("已结清");
  expect(settledRow).not.toHaveTextContent("¥0.00");
  expect(within(balances).getAllByRole("img")).toHaveLength(3);
  expect(within(balances).getAllByRole("img")[0]).toHaveClass("size-10");
});

test("结算中的每个成员头像使用上下文投影的预设", () => {
  render(
    <SettlementPage
      data={{ ...data, settlements: [settlement] }}
      timeZone="Asia/Shanghai"
      createSettlement={vi.fn()}
    />,
  );

  for (const [name, source] of [
    ["小王", "/member-avatars/avatar-02.webp"],
    ["小李", "/member-avatars/avatar-05.webp"],
  ]) {
    for (const avatar of screen.getAllByRole("img", {
      name: `${name}的头像`,
    })) {
      expect(avatar.querySelector("img")).toHaveAttribute("src", source);
    }
  }
});

test("推荐只预填表单，超额需要明确二次确认", async () => {
  const user = userEvent.setup();
  const createSettlement = vi
    .fn()
    .mockRejectedValueOnce({
      code: "OVER_SETTLEMENT_CONFIRMATION_REQUIRED",
      message: "本次支付比当前应付多 ¥73.50，保存后可能产生新的反向余额",
      details: { overAmountMinor: "7350" },
    })
    .mockResolvedValueOnce({ settlement: { id: "s1" } });
  render(
    <SettlementPage
      data={{
        ...data,
        activity: { ...data.activity, currentMemberRole: "OWNER" },
        recommendations: [
          {
            payerMemberId: "m2",
            receiverMemberId: "m1",
            amountMinor: "32650",
          },
        ],
      }}
      timeZone="Asia/Shanghai"
      createSettlement={createSettlement}
    />,
  );

  await user.click(screen.getByRole("button", { name: /按建议记录/ }));
  expect(screen.getByLabelText("付款人")).toHaveValue("m2");
  expect(screen.getByLabelText("收款人")).toHaveValue("m1");
  expect(screen.getByLabelText("金额")).toHaveValue("326.50");
  expect(createSettlement).not.toHaveBeenCalled();
  await user.clear(screen.getByLabelText("金额"));
  await user.type(screen.getByLabelText("金额"), "400");
  await user.click(screen.getByRole("button", { name: "确认已支付" }));

  expect(
    await screen.findByRole("alertdialog", { name: "确认超额结算" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "仍然记录 ¥400.00" }));
  expect(createSettlement).toHaveBeenLastCalledWith(
    expect.objectContaining({ confirmOverSettlement: true }),
  );
});

test("实际记录约束超长关系与备注，避免推挤金额或横向滚动", () => {
  const payerName = "付款人无断点名称".repeat(8);
  const receiverName = "收款人无断点名称".repeat(8);
  const note = "超长无断点备注".repeat(12);
  render(
    <SettlementPage
      data={{
        ...data,
        members: [
          { id: "m1", displayName: payerName, status: "ACTIVE" },
          { id: "m2", displayName: receiverName, status: "ACTIVE" },
        ],
        settlements: [{ ...settlement, note }],
      }}
      timeZone="Asia/Shanghai"
      createSettlement={vi.fn()}
    />,
  );

  const history = screen.getByRole("region", { name: "实际结算记录" });
  const historyList = within(history).getByRole("list", {
    name: "实际结算记录",
  });
  expect(within(historyList).queryAllByRole("img")).toHaveLength(0);
  expect(within(historyList).getByText(payerName)).toHaveClass("truncate");
  expect(within(historyList).getByText(receiverName)).toHaveClass("truncate");
  expect(within(historyList).getByTestId("history-direction")).toBeVisible();
  expect(within(history).getByText(note)).toHaveClass(
    "min-w-0",
    "[overflow-wrap:anywhere]",
  );
});

test("LEFT 成员付款人固定为自己，ARCHIVED 不显示记录入口", async () => {
  const user = userEvent.setup();
  const { rerender } = render(
    <SettlementPage
      data={{
        ...data,
        activity: { ...data.activity, currentMemberStatus: "LEFT" },
        members: [
          ...data.members,
          { id: "m3", displayName: "老陈", status: "LEFT" },
        ],
      }}
      timeZone="Asia/Shanghai"
      createSettlement={vi.fn()}
    />,
  );
  await user.click(screen.getByRole("button", { name: "记录结算" }));
  expect(screen.getByLabelText("付款人")).toBeDisabled();
  expect(screen.getByLabelText("付款人")).toHaveValue("m1");
  expect(screen.getByRole("option", { name: "老陈（已退出）" })).toBeVisible();

  rerender(
    <SettlementPage
      data={{ ...data, activity: { ...data.activity, status: "ARCHIVED" } }}
      timeZone="Asia/Shanghai"
      createSettlement={vi.fn()}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "记录结算" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "补记结算" }),
  ).not.toBeInTheDocument();
});

test("离线时记录入口与推荐预填均禁用并解释原因", () => {
  render(
    <SettlementPage
      data={data}
      timeZone="Asia/Shanghai"
      createSettlement={vi.fn()}
    />,
  );

  act(() => window.dispatchEvent(new Event("offline")));
  expect(screen.getByRole("button", { name: "记录结算" })).toBeDisabled();
  expect(screen.getByRole("button", { name: /按建议记录/ })).toBeDisabled();
  expect(screen.getByText("当前离线，联网后可记录结算。")).toBeVisible();
});

test("无历史时使用轻量文字，ENDED 可写状态仍保留补记入口", () => {
  render(
    <SettlementPage
      data={{
        ...data,
        activity: { ...data.activity, status: "ENDED" },
        settlements: [],
      }}
      timeZone="Asia/Shanghai"
      createSettlement={vi.fn()}
    />,
  );

  const history = screen.getByRole("region", { name: "实际结算记录" });
  expect(within(history).getByText("暂无结算记录")).toBeVisible();
  expect(within(history).queryByRole("img")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "补记结算" })).toBeVisible();
});

test("Sticky 主操作同时避让工作区边距和底部安全区", () => {
  render(
    <SettlementPage
      data={data}
      timeZone="Asia/Shanghai"
      createSettlement={vi.fn()}
    />,
  );

  expect(
    screen.getByRole("button", { name: "记录结算" }).parentElement,
  ).toHaveClass(
    "-mx-4",
    "mt-auto",
    "pt-6",
    "min-[481px]:-mx-6",
    "pb-[calc(0.75rem+env(safe-area-inset-bottom))]",
  );
});
