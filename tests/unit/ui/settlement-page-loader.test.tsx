// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getContext: vi.fn(),
  getSettlements: vi.fn(),
  getSummary: vi.fn(),
  page: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ activityId: "activity-1" }),
  useSearchParams: () => new URLSearchParams("?tab=settlement"),
}));
vi.mock("@/features/settlements/api", () => ({
  createSettlement: vi.fn(),
  getSettlementContext: mocks.getContext,
  getSettlements: mocks.getSettlements,
}));
vi.mock("@/features/expenses/api", () => ({
  getExpenseFeedSummary: mocks.getSummary,
}));
vi.mock("@/features/settlements/components/settlement-page", () => ({
  SettlementPage: (props: unknown) => {
    mocks.page(props);
    return <p>结算已加载</p>;
  },
}));

import { SettlementPageLoader } from "@/features/settlements/components/settlement-page-loader";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("加载器并行读取结算上下文、记录和活动摘要并透传时区", async () => {
  const context = { activity: { id: "activity-1" } };
  const settlements = [{ id: "settlement-1" }];
  const summary = {
    activityName: "大阪旅行",
    startDate: "2026-08-20",
    endDate: "2026-08-24",
    memberCount: 2,
  };
  mocks.getContext.mockResolvedValue(context);
  mocks.getSettlements.mockResolvedValue(settlements);
  mocks.getSummary.mockResolvedValue(summary);

  render(<SettlementPageLoader timeZone="Pacific/Honolulu" />);

  expect(await screen.findByText("结算已加载")).toBeVisible();
  expect(mocks.getContext).toHaveBeenCalledWith("activity-1");
  expect(mocks.getSettlements).toHaveBeenCalledWith("activity-1");
  expect(mocks.getSummary).toHaveBeenCalledWith("activity-1");
  await waitFor(() =>
    expect(mocks.page).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ summary, settlements }),
        timeZone: "Pacific/Honolulu",
      }),
    ),
  );
});
