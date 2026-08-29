// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";

import { ShareSummaryCard } from "@/features/settlements/share-summary/components/share-summary-card";

const data = {
  activityName: "北京之旅",
  memberCount: 5,
  currency: "CNY",
  totalAmountMinor: 12200n,
  viewerSummary: {
    status: "receivable" as const,
    amountMinor: 8660n,
  },
  recommendations: [
    { fromName: "VV", toName: "林樾", amountMinor: 3780n },
    { fromName: "B", toName: "林樾", amountMinor: 2440n },
    { fromName: "A", toName: "林樾", amountMinor: 2440n },
  ],
  balances: [
    { memberName: "C", status: "settled" as const, amountMinor: 0n },
    { memberName: "VV", status: "payable" as const, amountMinor: 3780n },
    { memberName: "B", status: "payable" as const, amountMinor: 2440n },
    { memberName: "林樾", status: "receivable" as const, amountMinor: 8660n },
    { memberName: "A", status: "payable" as const, amountMinor: 2440n },
  ],
};

test("分享卡展示可核对的结算结论且不含应用操作", () => {
  render(<ShareSummaryCard data={data} />);

  const card = document.getElementById("share-summary-card");
  expect(card).toBeInTheDocument();
  expect(card).toHaveClass("w-[800px]");
  expect(within(card!).getByText("结算摘要")).toBeVisible();
  expect(
    within(card!).getByRole("heading", { name: "北京之旅" }),
  ).toBeVisible();
  expect(within(card!).getByText("5人 · 总支出")).toHaveTextContent(
    "5人 · 总支出 ¥122.00",
  );
  const viewerSettlement = within(card!).getByRole("region", {
    name: "我的结算",
  });
  expect(within(viewerSettlement).getByText("应收")).toBeVisible();
  expect(within(viewerSettlement).getByText("¥86.60")).toBeVisible();

  const recommendations = within(card!).getByRole("list", {
    name: "推荐结算",
  });
  const recommendationRows = within(recommendations).getAllByRole("listitem");
  expect(recommendationRows[0]).toHaveTextContent("VV 向 林樾 支付");
  expect(within(recommendationRows[0]!).getByText("¥37.80")).toBeVisible();
  expect(recommendationRows[1]).toHaveTextContent("B 向 林樾 支付");
  expect(within(recommendationRows[1]!).getByText("¥24.40")).toBeVisible();
  expect(recommendationRows[2]).toHaveTextContent("A 向 林樾 支付");
  expect(within(recommendationRows[2]!).getByText("¥24.40")).toBeVisible();

  const balances = within(card!).getByRole("list", { name: "成员余额" });
  const balanceRows = within(balances).getAllByRole("listitem");
  expect(balanceRows[0]).toHaveTextContent("已结清¥0.00");
  expect(balanceRows[1]).toHaveTextContent("应付¥37.80");
  expect(balanceRows[3]).toHaveTextContent("应收¥86.60");
  const notes = within(card!).getByRole("region", { name: "结算说明" });
  expect(notes).toHaveTextContent("金额已根据活动账单自动计算");
  expect(notes).toHaveTextContent("推荐结算已尽量减少转账次数");
  expect(within(card!).getByText("一起消费，清楚结算")).toBeVisible();
  expect(within(card!).queryByRole("button")).not.toBeInTheDocument();
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
});
