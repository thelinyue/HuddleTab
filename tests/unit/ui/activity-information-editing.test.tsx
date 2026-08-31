// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActivityDetails: vi.fn(),
  getActivityHome: vi.fn(),
  updateActivityDetails: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ activityId: "activity-1" }),
}));
vi.mock("@/features/activities/api", () => ({
  getActivityDetails: mocks.getActivityDetails,
  getActivityHome: mocks.getActivityHome,
  updateActivityDetails: mocks.updateActivityDetails,
}));

import {
  ActivityMore,
  type ActivityManagementView,
} from "@/features/activities/components/activity-more";

const details = {
  id: "activity-1",
  name: "大阪行",
  location: "日本大阪",
  baseCurrency: "CNY",
  startDate: "2026-08-31",
  endDate: null,
  status: "ACTIVE" as const,
  revision: "4",
  currentMemberRole: "OWNER" as const,
  currentMemberStatus: "ACTIVE" as const,
  hasAccountingRecords: true,
  earliestExpenseDate: "2026-08-25",
  permissions: {
    name: true,
    location: true,
    baseCurrency: false,
    startDate: true,
    endDate: true,
  },
};

function Harness() {
  const [view, setView] = useState<ActivityManagementView>("root");
  return <ActivityMore embedded view={view} onViewChange={setView} />;
}

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  mocks.getActivityDetails.mockResolvedValue(details);
  mocks.getActivityHome.mockResolvedValue({
    summaries: [],
    active: [{ ...details, myNetMinor: "0", memberCount: 4 }],
    ended: [],
    archived: [],
  });
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

test("活动名称为首行，只有可编辑字段渲染按钮和 Chevron", async () => {
  render(<Harness />);

  const information = await screen.findByRole("group", { name: "活动信息" });
  const labels = within(information)
    .getAllByTestId("activity-info-label")
    .map((node) => node.textContent);
  expect(labels.slice(0, 5)).toEqual([
    "活动名称",
    "地点",
    "主币种",
    "开始日期",
    "结束日期",
  ]);
  expect(screen.getByRole("button", { name: "编辑活动名称" })).toBeVisible();
  expect(screen.getByRole("button", { name: "编辑地点" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "编辑主币种" })).not.toBeInTheDocument();
  expect(screen.getByText("CNY · 人民币")).toBeVisible();
  expect(screen.getByText("已有账务记录，不可修改")).toBeVisible();
  const currencyRow = screen.getByText("主币种").closest("div");
  expect(currencyRow?.querySelector(".lucide-chevron-right")).toBeNull();
});

test("清空地点显式保存 null，并用新详情刷新权限", async () => {
  const user = userEvent.setup();
  const updated = { ...details, location: null, revision: "5" };
  mocks.updateActivityDetails.mockResolvedValue({
    activity: updated,
    warnings: [],
  });
  mocks.getActivityDetails
    .mockResolvedValueOnce(details)
    .mockResolvedValueOnce(updated);
  render(<Harness />);

  await user.click(await screen.findByRole("button", { name: "编辑地点" }));
  const input = screen.getByRole("textbox", { name: "地点" });
  await user.clear(input);
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(mocks.updateActivityDetails).toHaveBeenCalledWith("activity-1", {
    revision: "4",
    location: null,
  });
  await waitFor(() => expect(mocks.getActivityDetails).toHaveBeenCalledTimes(2));
  expect(
    within(screen.getByRole("button", { name: "编辑地点" })).getByText(
      "未填写",
    ),
  ).toBeVisible();
});

test("Member 与 LEFT 的活动资料全部为只读", async () => {
  mocks.getActivityDetails.mockResolvedValue({
    ...details,
    currentMemberRole: "MEMBER",
    currentMemberStatus: "LEFT",
    permissions: {
      name: false,
      location: false,
      baseCurrency: false,
      startDate: false,
      endDate: false,
    },
  });
  render(<Harness />);

  await screen.findByRole("group", { name: "活动信息" });
  expect(screen.queryByRole("button", { name: /^编辑/ })).not.toBeInTheDocument();
});

test("活动主币种在无账务时从标准列表选择，并显式保存 ISO code", async () => {
  const user = userEvent.setup();
  const editable = {
    ...details,
    hasAccountingRecords: false,
    permissions: { ...details.permissions, baseCurrency: true },
  };
  const updated = { ...editable, baseCurrency: "JPY", revision: "5" };
  mocks.getActivityDetails
    .mockResolvedValueOnce(editable)
    .mockResolvedValueOnce(updated);
  mocks.updateActivityDetails.mockResolvedValue({
    activity: updated,
    warnings: [],
  });
  render(<Harness />);

  await user.click(
    await screen.findByRole("button", { name: "编辑主币种" }),
  );
  await user.click(screen.getByRole("option", { name: /JPY.*日元/ }));
  expect(mocks.updateActivityDetails).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(mocks.updateActivityDetails).toHaveBeenCalledWith("activity-1", {
    revision: "4",
    baseCurrency: "JPY",
  });
  expect(await screen.findByText("JPY · 日元")).toBeVisible();
});

test("开始日期晚于已有消费时保存成功并显示非阻断提示", async () => {
  const user = userEvent.setup();
  const updated = {
    ...details,
    startDate: "2026-08-30",
    revision: "5",
  };
  mocks.getActivityDetails
    .mockResolvedValueOnce(details)
    .mockResolvedValueOnce(updated);
  mocks.updateActivityDetails.mockResolvedValue({
    activity: updated,
    warnings: ["EXPENSE_BEFORE_ACTIVITY_START"],
  });
  render(<Harness />);

  await user.click(
    await screen.findByRole("button", { name: "编辑开始日期" }),
  );
  const input = screen.getByLabelText("开始日期");
  await user.clear(input);
  await user.type(input, "2026-08-30");
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(await screen.findByRole("status")).toHaveTextContent(
    "已有部分消费时间早于新的活动开始日期。",
  );
  expect(mocks.updateActivityDetails).toHaveBeenCalledWith("activity-1", {
    revision: "4",
    startDate: "2026-08-30",
  });
});
