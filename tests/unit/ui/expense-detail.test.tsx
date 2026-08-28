// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import type { ExpenseDetailResponse } from "@/features/expenses/api";
import { ExpenseDetail } from "@/features/expenses/components/expense-detail";

afterEach(cleanup);

const detail: ExpenseDetailResponse = {
  expense: {
    id: "expense-1",
    activityId: "activity-1",
    title: "海底捞火锅",
    category: "FOOD",
    originalAmountMinor: "42800",
    originalCurrency: "CNY",
    baseAmountMinor: "42800",
    baseCurrency: "CNY",
    exchangeRate: "1",
    exchangeRateSource: "IDENTITY",
    exchangeRateAt: "2026-08-27T08:00:00.000Z",
    splitMode: "EQUAL",
    occurredAt: "2026-08-27T08:00:00.000Z",
    note: null,
    createdByMemberId: "m1",
    createdByDisplayName: "我",
    createdByAvatarPreset: 4,
    createdAt: "2026-08-27T08:03:00.000Z",
    updatedAt: "2026-08-27T08:03:00.000Z",
    version: 1,
  },
  payments: [
    {
      memberId: "m1",
      memberDisplayName: "我",
      avatarPreset: 2,
      originalAmountMinor: "42800",
      baseAmountMinor: "42800",
    },
  ],
  shares: [
    {
      memberId: "m1",
      memberDisplayName: "我",
      avatarPreset: 2,
      splitInputMinor: null,
      originalAmountMinor: "10700",
      baseAmountMinor: "10700",
    },
    {
      memberId: "m2",
      memberDisplayName: "小王",
      avatarPreset: null,
      splitInputMinor: null,
      originalAmountMinor: "10700",
      baseAmountMinor: "10700",
    },
    {
      memberId: "m3",
      memberDisplayName: "小李",
      avatarPreset: 3,
      splitInputMinor: null,
      originalAmountMinor: "10700",
      baseAmountMinor: "10700",
    },
    {
      memberId: "m4",
      memberDisplayName: "小陈",
      avatarPreset: null,
      splitInputMinor: null,
      originalAmountMinor: "10700",
      baseAmountMinor: "10700",
    },
  ],
  attachments: [],
  permissions: { canUpdate: false, canDelete: false },
};

test("账单详情按查看链路展示真实信息，并只保留分摊方式入口", () => {
  render(
    <ExpenseDetail
      data={detail}
      activityName="日本大阪之旅"
      timeZone="Asia/Shanghai"
    />,
  );

  expect(screen.getByRole("heading", { name: "账单详情" })).toBeInTheDocument();
  expect(screen.getByText("海底捞火锅")).toBeInTheDocument();
  expect(screen.getAllByText("¥428.00").length).toBeGreaterThan(0);

  const payments = screen.getByRole("region", { name: "付款信息" });
  expect(payments).toHaveTextContent("我付款人¥428.00");
  expect(payments).toHaveTextContent("支付合计¥428.00");

  const expenseInfo = screen.getByRole("region", { name: "消费信息" });
  expect(expenseInfo).toHaveTextContent("消费时间2026-08-27 16:00");
  expect(
    within(expenseInfo).getByRole("link", { name: "查看活动 日本大阪之旅" }),
  ).toHaveAttribute("href", "/activities/activity-1");
  expect(expenseInfo).toHaveTextContent("分类餐饮");
  expect(expenseInfo).toHaveTextContent("备注无");
  expect(expenseInfo).not.toHaveTextContent("支付时间");
  expect(expenseInfo).not.toHaveTextContent("流水编号");

  const splitInfo = screen.getByRole("region", { name: "分摊信息" });
  expect(
    within(splitInfo).getByRole("link", { name: "查看分摊明细" }),
  ).toHaveAttribute("href", "/activities/activity-1/expenses/expense-1/split");
  expect(splitInfo).toHaveTextContent("均摊（4人）");
  expect(within(splitInfo).getAllByRole("img")).toHaveLength(4);

  const creationInfo = screen.getByRole("region", { name: "创建信息" });
  expect(creationInfo).toHaveTextContent("创建人我");
  expect(creationInfo).toHaveTextContent("创建时间2026-08-27 16:03");
  expect(
    screen.queryByRole("region", { name: "附件" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "账单操作" }),
  ).not.toBeInTheDocument();
});

test("账单详情将创建人、付款人与分摊成员的头像预设传到图片", () => {
  render(
    <ExpenseDetail
      data={detail}
      activityName="日本大阪之旅"
      timeZone="Asia/Shanghai"
    />,
  );

  expect(
    screen
      .getByRole("region", { name: "付款信息" })
      .querySelector('[role="img"] img'),
  ).toHaveAttribute("src", "/member-avatars/avatar-02.webp");
  expect(
    screen
      .getByRole("region", { name: "分摊信息" })
      .querySelectorAll('[role="img"] img')[2],
  ).toHaveAttribute("src", "/member-avatars/avatar-03.webp");
  expect(
    screen
      .getByRole("region", { name: "创建信息" })
      .querySelector('[role="img"] img'),
  ).toHaveAttribute("src", "/member-avatars/avatar-04.webp");
});

test("创建人没有预设时按创建成员 ID 回退头像，而非首笔付款人", () => {
  render(
    <ExpenseDetail
      data={{
        ...detail,
        expense: {
          ...detail.expense,
          createdByMemberId: "creator-member",
          createdByAvatarPreset: null,
        },
        payments: [
          {
            ...detail.payments[0]!,
            memberId: "payer-member",
          },
        ],
      }}
      activityName="日本大阪之旅"
      timeZone="Asia/Shanghai"
    />,
  );

  expect(
    screen
      .getByRole("region", { name: "创建信息" })
      .querySelector('[role="img"] img'),
  ).toHaveAttribute("src", "/member-avatars/avatar-06.webp");
});

test("有管理权限时通过单一菜单编辑或二次确认删除账单", async () => {
  const user = userEvent.setup();
  const onEdit = vi.fn();
  const onDelete = vi.fn().mockResolvedValue(undefined);
  render(
    <ExpenseDetail
      data={{
        ...detail,
        permissions: { canUpdate: true, canDelete: true },
      }}
      activityName="日本大阪之旅"
      timeZone="Asia/Shanghai"
      onEdit={onEdit}
      onDelete={onDelete}
    />,
  );

  await user.click(screen.getByRole("button", { name: "账单操作" }));
  await user.click(screen.getByRole("menuitem", { name: "编辑账单" }));
  expect(onEdit).toHaveBeenCalledOnce();

  await user.click(screen.getByRole("button", { name: "账单操作" }));
  await user.click(screen.getByRole("menuitem", { name: "删除账单" }));
  const dialog = screen.getByRole("alertdialog", { name: "确认删除账单" });
  expect(dialog).toHaveTextContent("删除后，这笔账单将不再计入活动账务");
  await user.click(within(dialog).getByRole("button", { name: "确认删除" }));
  expect(onDelete).toHaveBeenCalledOnce();
});

test("删除失败时保留确认框并展示可理解的错误", async () => {
  const user = userEvent.setup();
  render(
    <ExpenseDetail
      data={{
        ...detail,
        permissions: { canUpdate: false, canDelete: true },
      }}
      activityName="日本大阪之旅"
      timeZone="Asia/Shanghai"
      onDelete={vi.fn().mockRejectedValue(new Error("账单已被其他成员修改。"))}
    />,
  );

  await user.click(screen.getByRole("button", { name: "账单操作" }));
  await user.click(screen.getByRole("menuitem", { name: "删除账单" }));
  const dialog = screen.getByRole("alertdialog", { name: "确认删除账单" });
  await user.click(within(dialog).getByRole("button", { name: "确认删除" }));

  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "账单已被其他成员修改。",
  );
  expect(dialog).toBeInTheDocument();
});
