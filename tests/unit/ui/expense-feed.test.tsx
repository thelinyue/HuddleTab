// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { ExpenseFeed } from "@/features/expenses/components/expense-feed";

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
  vi.unstubAllGlobals();
});

test("流水只提供名称、固定分类和我参与的筛选", async () => {
  const user = userEvent.setup();
  const onFiltersChange = vi.fn();
  render(
    <ExpenseFeed
      activity={{
        id: "activity-1",
        name: "大阪",
        currency: "CNY",
        totalExpenseMinor: "6000",
        originalCurrencyTotals: [{ currency: "JPY", amountMinor: "6000" }],
        startDate: "2026-08-20",
        endDate: "2026-08-24",
        memberCount: 3,
        expenseCount: 1,
        participatingMemberCount: 2,
        averageExpenseMinor: "150",
      }}
      timeZone="Asia/Shanghai"
      onFiltersChange={onFiltersChange}
      expenses={[
        {
          id: "expense-1",
          title: "一兰拉面",
          category: "FOOD",
          originalAmountMinor: "6000",
          originalCurrency: "JPY",
          baseAmountMinor: "300",
          baseCurrency: "CNY",
          occurredAt: "2026-08-23T08:00:00.000Z",
          payerSummary: "小王",
          participantCount: 2,
        },
      ]}
    />,
  );

  expect(
    screen.queryByRole("searchbox", { name: "搜索消费名称" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "筛选流水" }));
  const filterDialog = screen.getByRole("dialog", { name: "筛选流水" });
  expect(
    within(filterDialog).getByRole("searchbox", { name: "搜索消费名称" }),
  ).toBeVisible();
  const foodFilter = within(filterDialog).getByRole("button", { name: "餐饮" });
  expect(foodFilter).toBeVisible();
  expect(
    foodFilter.querySelector('img[data-category-illustration="FOOD"]'),
  ).not.toBeNull();
  expect(
    foodFilter.querySelector('img[data-category-illustration="FOOD"]'),
  ).not.toHaveClass("rounded-full");
  expect(screen.getByRole("checkbox", { name: "只看我参与的" })).toBeVisible();
  await user.type(screen.getByRole("searchbox"), "拉面");
  expect(screen.getByText("一兰拉面")).toBeVisible();
  expect(onFiltersChange).not.toHaveBeenCalled();
  await user.click(
    within(filterDialog).getByRole("button", { name: "应用筛选" }),
  );
  expect(onFiltersChange).toHaveBeenLastCalledWith({
    query: "拉面",
    category: null,
    mine: false,
  });
});

test("流水消费摘要只显示总消费、笔数和按参与成员计算的人均消费", () => {
  render(
    <ExpenseFeed
      activity={{
        id: "activity-1",
        name: "大阪",
        currency: "CNY",
        totalExpenseMinor: "6000",
        originalCurrencyTotals: [],
        startDate: "2026-08-20",
        endDate: "2026-08-24",
        memberCount: 3,
        expenseCount: 3,
        participatingMemberCount: 4,
        averageExpenseMinor: "1500",
      }}
      timeZone="Asia/Shanghai"
      expenses={[]}
      entryContext={
        {
          activity: { status: "ACTIVE" },
          permissions: { canCreateExpense: false, canManageMembers: false },
        } as never
      }
    />,
  );

  expect(screen.getByRole("banner", { name: "活动信息" })).toHaveTextContent(
    "5天 · 3人 · 进行中",
  );
  expect(screen.getByLabelText("消费摘要")).toHaveTextContent(
    "总消费¥60.003 笔消费 · 人均消费 ¥15.00",
  );
  expect(screen.queryByText("我的结算")).not.toBeInTheDocument();
});

test("消费链接保留所属活动并按发生日期分组", () => {
  render(
    <ExpenseFeed
      activity={{
        id: "activity-1",
        name: "大阪",
        currency: "CNY",
        totalExpenseMinor: "6000",
        originalCurrencyTotals: [],
        startDate: "2026-08-20",
        endDate: "2026-08-24",
        memberCount: 3,
        expenseCount: 2,
        participatingMemberCount: 2,
        averageExpenseMinor: "4000",
      }}
      timeZone="Pacific/Honolulu"
      expenses={[
        {
          id: "expense-1",
          title: "午餐",
          category: "FOOD",
          originalAmountMinor: "6000",
          originalCurrency: "CNY",
          baseAmountMinor: "6000",
          baseCurrency: "CNY",
          occurredAt: "2026-08-23T08:00:00.000Z",
        },
        {
          id: "expense-2",
          title: "早餐",
          category: "FOOD",
          originalAmountMinor: "2000",
          originalCurrency: "CNY",
          baseAmountMinor: "2000",
          baseCurrency: "CNY",
          occurredAt: "2026-08-22T08:00:00.000Z",
        },
      ]}
    />,
  );

  const lunchLink = screen.getByRole("link", { name: /午餐/ });
  expect(lunchLink).toHaveAttribute(
    "href",
    "/activities/activity-1/expenses/expense-1",
  );
  expect(
    lunchLink.querySelector('img[data-category-illustration="FOOD"]'),
  ).not.toBeNull();
  expect(
    lunchLink.querySelector('img[data-category-illustration="FOOD"]'),
  ).not.toHaveClass("rounded-full");
  expect(screen.getByRole("list", { name: "2026年8月22日" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "2026年8月21日" })).toBeVisible();
});

test("仅一个 active 正式成员时在摘要前展示邀请提示，临时成员不计入", () => {
  render(
    <ExpenseFeed
      activity={{
        id: "activity-1",
        name: "大阪",
        currency: "CNY",
        totalExpenseMinor: "0",
        originalCurrencyTotals: [],
        startDate: "2026-08-20",
        endDate: "2026-08-24",
        memberCount: 2,
      }}
      timeZone="Asia/Shanghai"
      expenses={[]}
      entryContext={
        {
          activity: { status: "ACTIVE" },
          members: [
            {
              id: "owner",
              displayName: "Owner",
              status: "ACTIVE",
              memberType: "USER",
            },
            {
              id: "guest",
              displayName: "Guest",
              status: "ACTIVE",
              memberType: "GUEST",
            },
          ],
          permissions: { canCreateExpense: true, canManageMembers: true },
        } as never
      }
    />,
  );
  expect(
    screen.getByRole("link", { name: /邀请成员一起记账/ }),
  ).toHaveAttribute("href", "/activities/activity-1?panel=members&invite=1");
});

test.each([
  [
    "两个 active 正式成员",
    [
      {
        id: "owner",
        displayName: "Owner",
        status: "ACTIVE",
        memberType: "USER",
      },
      {
        id: "member",
        displayName: "Member",
        status: "ACTIVE",
        memberType: "USER",
      },
    ],
    "ACTIVE",
    true,
  ],
  [
    "仅一个 active 正式成员但无管理权限",
    [
      {
        id: "owner",
        displayName: "Owner",
        status: "ACTIVE",
        memberType: "USER",
      },
    ],
    "ACTIVE",
    false,
  ],
  [
    "活动已结束",
    [
      {
        id: "owner",
        displayName: "Owner",
        status: "ACTIVE",
        memberType: "USER",
      },
    ],
    "ENDED",
    true,
  ],
  [
    "仅已离开正式成员",
    [{ id: "owner", displayName: "Owner", status: "LEFT", memberType: "USER" }],
    "ACTIVE",
    true,
  ],
] as const)(
  "%s 时不展示邀请提示",
  (_label, members, status, canManageMembers) => {
    render(
      <ExpenseFeed
        activity={{
          id: "activity-1",
          name: "大阪",
          currency: "CNY",
          totalExpenseMinor: "0",
          originalCurrencyTotals: [],
          startDate: null,
          endDate: null,
          memberCount: members.length,
        }}
        timeZone="Asia/Shanghai"
        expenses={[]}
        entryContext={
          {
            activity: { status },
            members,
            permissions: { canCreateExpense: false, canManageMembers },
          } as never
        }
      />,
    );
    expect(
      screen.queryByRole("link", { name: /邀请成员一起记账/ }),
    ).not.toBeInTheDocument();
  },
);
