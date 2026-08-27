// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const navigation = vi.hoisted(() => ({ activityId: "activity-1" }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ activityId: navigation.activityId }),
}));

import { ActivityMore } from "@/features/activities/components/activity-more";

beforeEach(() => {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("更多页展示真实摘要、导出和当前生命周期状态", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          activity: {
            status: "ACTIVE",
            currentMemberRole: "ADMIN",
            currentMemberStatus: "ACTIVE",
          },
        },
      }),
    }),
  );

  render(<ActivityMore />);

  expect(await screen.findByText("进行中")).toBeVisible();
  expect(screen.getByRole("link", { name: "结算摘要" })).toHaveAttribute(
    "href",
    "/activities/activity-1/summary",
  );
  expect(screen.getByRole("link", { name: "导出 CSV" })).toHaveAttribute(
    "href",
    "/api/activities/activity-1/export.csv",
  );
  expect(screen.getByRole("button", { name: "结束活动" })).toBeVisible();
});

test("离线时活动操作提示具有状态语义", async () => {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          activity: {
            status: "ACTIVE",
            currentMemberRole: "OWNER",
            currentMemberStatus: "ACTIVE",
          },
        },
      }),
    }),
  );

  render(<ActivityMore />);

  expect(await screen.findByRole("status")).toHaveTextContent(
    "活动操作必须联网后执行。",
  );
  expect(screen.getByRole("button", { name: "结束活动" })).toBeDisabled();
});

test("已结束活动只向 Owner 展示归档命令，Admin 仍可恢复活动", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          activity: {
            status: "ENDED",
            currentMemberRole: "ADMIN",
            currentMemberStatus: "ACTIVE",
          },
        },
      }),
    }),
  );

  render(<ActivityMore />);

  expect(await screen.findByRole("button", { name: "恢复活动" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "归档活动" }),
  ).not.toBeInTheDocument();
});

test("已离开活动的 Owner 不显示任何生命周期命令", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          activity: {
            status: "ENDED",
            currentMemberRole: "OWNER",
            currentMemberStatus: "LEFT",
          },
        },
      }),
    }),
  );

  render(<ActivityMore />);

  await screen.findByText("已结束");
  expect(
    screen.queryByRole("heading", { name: "活动操作" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /恢复活动|归档活动/ }),
  ).not.toBeInTheDocument();
});

test("生命周期操作成功后立即使用已知转换刷新状态和命令", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            activity: {
              status: "ACTIVE",
              currentMemberRole: "OWNER",
              currentMemberStatus: "ACTIVE",
            },
          },
        }),
      })
      .mockResolvedValueOnce({ ok: true }),
  );

  render(<ActivityMore />);

  await user.click(await screen.findByRole("button", { name: "结束活动" }));
  expect(await screen.findByText("已结束")).toBeVisible();
  expect(screen.getByRole("button", { name: "恢复活动" })).toBeVisible();
  expect(screen.getByRole("button", { name: "归档活动" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "结束活动" }),
  ).not.toBeInTheDocument();
});

test("生命周期操作失败后保留原状态和原命令", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            activity: {
              status: "ACTIVE",
              currentMemberRole: "OWNER",
              currentMemberStatus: "ACTIVE",
            },
          },
        }),
      })
      .mockResolvedValueOnce({ ok: false }),
  );

  render(<ActivityMore />);

  await user.click(await screen.findByRole("button", { name: "结束活动" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("活动操作未完成");
  expect(screen.getByText("进行中")).toBeVisible();
  expect(screen.getByRole("button", { name: "结束活动" })).toBeVisible();
});
