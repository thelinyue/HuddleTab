// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import type { ExpenseDetailResponse } from "@/features/expenses/api";
import { ExpenseSplitDetail } from "@/features/expenses/components/expense-split-detail";

afterEach(cleanup);

const percentageDetail: ExpenseDetailResponse = {
  expense: {
    id: "expense-1",
    activityId: "activity-1",
    title: "关西烤肉",
    category: "FOOD",
    originalAmountMinor: "60000",
    originalCurrency: "CNY",
    baseAmountMinor: "60000",
    baseCurrency: "CNY",
    exchangeRate: "1",
    exchangeRateSource: "IDENTITY",
    exchangeRateAt: "2026-08-27T08:00:00.000Z",
    splitMode: "PERCENTAGE",
    occurredAt: "2026-08-27T08:00:00.000Z",
    note: null,
    createdByMemberId: "m1",
    createdByDisplayName: "我",
    version: 1,
    createdAt: "2026-08-27T08:03:00.000Z",
    updatedAt: "2026-08-27T08:03:00.000Z",
  },
  payments: [
    {
      memberId: "m1",
      memberDisplayName: "我",
      avatarPreset: 2,
      originalAmountMinor: "60000",
      baseAmountMinor: "60000",
    },
  ],
  shares: [
    {
      memberId: "m1",
      memberDisplayName: "我",
      avatarPreset: 2,
      splitInputMinor: "5000",
      originalAmountMinor: "30000",
      baseAmountMinor: "30000",
    },
    {
      memberId: "m2",
      memberDisplayName: "小王",
      avatarPreset: null,
      splitInputMinor: "3000",
      originalAmountMinor: "18000",
      baseAmountMinor: "18000",
    },
    {
      memberId: "m3",
      memberDisplayName: "小李",
      avatarPreset: 3,
      splitInputMinor: "2000",
      originalAmountMinor: "12000",
      baseAmountMinor: "12000",
    },
  ],
  attachments: [],
  permissions: { canUpdate: false, canDelete: false },
};

test("比例分摊按基点显示右侧比例，并按已支付减应承担计算净额", () => {
  render(
    <ExpenseSplitDetail data={percentageDetail} activityName="日本大阪之旅" />,
  );

  expect(screen.getByRole("heading", { name: "分摊明细" })).toBeVisible();
  expect(screen.getByRole("link", { name: "返回账单详情" })).toHaveAttribute(
    "href",
    "/activities/activity-1/expenses/expense-1",
  );

  const summary = screen.getByRole("region", { name: "账单摘要" });
  expect(summary).toHaveTextContent("关西烤肉");
  expect(summary).toHaveTextContent("日本大阪之旅 · 餐饮");
  expect(summary).toHaveTextContent("¥600.00");
  expect(summary).toHaveTextContent("分摊方式按比例");
  expect(summary).toHaveTextContent("分摊人数3人");
  expect(summary).not.toHaveTextContent("人均");

  const table = screen.getByRole("table", { name: "成员分摊明细" });
  const rows = within(table).getAllByRole("row");
  expect(rows).toHaveLength(4);
  expect(rows[1]).toHaveTextContent("我50%¥300.00¥600.00+¥300.00");
  expect(rows[2]).toHaveTextContent("小王30%¥180.00¥0.00−¥180.00");
  expect(rows[3]).toHaveTextContent("小李20%¥120.00¥0.00−¥120.00");

  const totals = screen.getByRole("region", { name: "账务校验" });
  expect(totals).toHaveTextContent("承担合计¥600.00");
  expect(totals).toHaveTextContent("支付合计¥600.00");
  expect(totals).toHaveTextContent("净额合计¥0.00");
  expect(screen.getByText("正数表示应收，负数表示应付")).toBeVisible();
});

test("分摊明细保留付款与承担成员的头像预设", () => {
  render(
    <ExpenseSplitDetail data={percentageDetail} activityName="日本大阪之旅" />,
  );

  const rows = within(
    screen.getByRole("table", { name: "成员分摊明细" }),
  ).getAllByRole("row");
  expect(rows[1]?.querySelector('[role="img"] img')).toHaveAttribute(
    "src",
    "/member-avatars/avatar-02.webp",
  );
  expect(rows[3]?.querySelector('[role="img"] img')).toHaveAttribute(
    "src",
    "/member-avatars/avatar-03.webp",
  );
});

test("均摊显示人均金额和付款人身份，并保持成员净额守恒", () => {
  const equalDetail: ExpenseDetailResponse = {
    ...percentageDetail,
    expense: {
      ...percentageDetail.expense,
      title: "海底捞火锅",
      baseAmountMinor: "42800",
      originalAmountMinor: "42800",
      splitMode: "EQUAL",
    },
    payments: [
      {
        memberId: "m1",
        memberDisplayName: "我",
        originalAmountMinor: "42800",
        baseAmountMinor: "42800",
      },
    ],
    shares: [
      {
        memberId: "m1",
        memberDisplayName: "我",
        splitInputMinor: null,
        originalAmountMinor: "10700",
        baseAmountMinor: "10700",
      },
      {
        memberId: "m2",
        memberDisplayName: "小王",
        splitInputMinor: null,
        originalAmountMinor: "10700",
        baseAmountMinor: "10700",
      },
      {
        memberId: "m3",
        memberDisplayName: "小李",
        splitInputMinor: null,
        originalAmountMinor: "10700",
        baseAmountMinor: "10700",
      },
      {
        memberId: "m4",
        memberDisplayName: "小陈",
        splitInputMinor: null,
        originalAmountMinor: "10700",
        baseAmountMinor: "10700",
      },
    ],
  };

  render(<ExpenseSplitDetail data={equalDetail} activityName="日本大阪之旅" />);

  const summary = screen.getByRole("region", { name: "账单摘要" });
  expect(summary).toHaveTextContent("分摊方式均摊");
  expect(summary).toHaveTextContent("分摊人数4人");
  expect(summary).toHaveTextContent("人均¥107.00");

  const table = screen.getByRole("table", { name: "成员分摊明细" });
  const rows = within(table).getAllByRole("row");
  expect(rows[1]).toHaveTextContent("我付款人¥107.00¥428.00+¥321.00");
  expect(rows[2]).toHaveTextContent("小王¥107.00¥0.00−¥107.00");
  expect(rows[3]).toHaveTextContent("小李¥107.00¥0.00−¥107.00");
  expect(rows[4]).toHaveTextContent("小陈¥107.00¥0.00−¥107.00");
});
