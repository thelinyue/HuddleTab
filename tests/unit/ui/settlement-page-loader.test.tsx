// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  SettlementPage: (props: { readonly onSaved?: () => void }) => {
    mocks.page(props);
    return (
      <>
        <p>结算已加载</p>
        <button type="button" onClick={props.onSaved}>
          模拟保存结算
        </button>
      </>
    );
  },
}));

import { SettlementPageLoader } from "@/features/settlements/components/settlement-page-loader";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("加载器并行读取结算上下文、记录和活动摘要并透传时区", async () => {
  const onHeaderData = vi.fn();
  const context = {
    activity: {
      id: "activity-1",
      status: "ACTIVE",
    },
  };
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

  render(
    <SettlementPageLoader
      timeZone="Pacific/Honolulu"
      onHeaderData={onHeaderData}
    />,
  );

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
  expect(onHeaderData).toHaveBeenCalledWith({
    activityId: "activity-1",
    name: "大阪旅行",
    startDate: "2026-08-20",
    endDate: "2026-08-24",
    memberCount: 2,
    status: "ACTIVE",
  });
});

test("保存结算后重新并行拉取上下文、推荐余额、摘要和实际记录", async () => {
  const user = userEvent.setup();
  mocks.getContext.mockResolvedValue({
    activity: { id: "activity-1", status: "ACTIVE" },
  });
  mocks.getSettlements.mockResolvedValue([]);
  mocks.getSummary.mockResolvedValue({
    activityName: "大阪旅行",
    startDate: "2026-08-20",
    endDate: "2026-08-24",
    memberCount: 2,
  });

  render(
    <SettlementPageLoader timeZone="Asia/Shanghai" onHeaderData={vi.fn()} />,
  );
  expect(await screen.findByText("结算已加载")).toBeVisible();

  await user.click(screen.getByRole("button", { name: "模拟保存结算" }));
  await waitFor(() => {
    expect(mocks.getContext).toHaveBeenCalledTimes(2);
    expect(mocks.getSettlements).toHaveBeenCalledTimes(2);
    expect(mocks.getSummary).toHaveBeenCalledTimes(2);
  });
});
