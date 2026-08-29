// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getShareSummary: vi.fn() }));

vi.mock("@/features/settlements/share-summary/api", () => ({
  getShareSummary: mocks.getShareSummary,
}));

import { ShareSummaryLoader } from "@/features/settlements/share-summary/components/share-summary-loader";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("加载器展示 API 返回的实际活动名称和结算金额", async () => {
  mocks.getShareSummary.mockResolvedValue({
    activityName: "真实活动",
    memberCount: 2,
    currency: "CNY",
    totalAmountMinor: 4500n,
    viewerSummary: { status: "receivable", amountMinor: 1200n },
    recommendations: [{ fromName: "小李", toName: "小王", amountMinor: 1200n }],
    balances: [
      { memberName: "小王", status: "receivable", amountMinor: 1200n },
      { memberName: "小李", status: "payable", amountMinor: 1200n },
    ],
  });

  render(<ShareSummaryLoader activityId="activity-1" />);

  expect(
    await screen.findByRole("heading", { name: "真实活动" }),
  ).toBeVisible();
  expect(screen.getByText("¥45.00")).toBeVisible();
  expect(screen.getAllByText("¥12.00")).not.toHaveLength(0);
  const recommendations = screen.getByRole("list", { name: "推荐结算" });
  expect(within(recommendations).getByRole("listitem")).toHaveTextContent(
    "小李 向 小王 支付",
  );
  expect(mocks.getShareSummary).toHaveBeenCalledWith("activity-1");
});

test("加载器展示摘要 API 的中文错误", async () => {
  mocks.getShareSummary.mockRejectedValue(
    new Error("活动不存在或您无权查看。"),
  );

  render(<ShareSummaryLoader activityId="activity-private" />);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "活动不存在或您无权查看。",
  );
});
