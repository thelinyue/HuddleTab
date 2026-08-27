// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
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
  vi.unstubAllGlobals();
});

test("跨活动应收应付不抵消，并按生命周期分组", () => {
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
          { id: "a", name: "杭州旅行", status: "ACTIVE", myNetMinor: "-3000" },
        ],
        ended: [
          { id: "b", name: "周末露营", status: "ENDED", myNetMinor: "5000" },
        ],
        archived: [],
      }}
    />,
  );

  expect(screen.getByLabelText("跨活动账务摘要")).toHaveTextContent(
    "待支付¥30.00",
  );
  expect(screen.getByLabelText("跨活动账务摘要")).toHaveTextContent(
    "待收款¥50.00",
  );
  expect(screen.getByRole("heading", { name: "进行中" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "最近结束" })).toBeVisible();
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
