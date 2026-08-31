// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { CreateActivityForm } from "@/features/activities/components/create-activity-form";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("开始日期默认使用部署 TZ 的当天", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-31T01:00:00.000Z"));

  render(<CreateActivityForm timeZone="Pacific/Honolulu" />);

  expect(screen.getByLabelText("开始日期")).toHaveValue("2026-08-30");
});

test("主币种使用标准选择触发器而不是自由文本", () => {
  render(<CreateActivityForm timeZone="Asia/Shanghai" />);

  expect(screen.queryByRole("textbox", { name: "主币种" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "主币种" })).toHaveTextContent(
    "CNY · 人民币",
  );
});

test("创建活动提交表单后进入活动页", async () => {
  const user = userEvent.setup();
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "a1" } }), { status: 201 }),
    );
  const assign = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { assign, origin: "http://localhost" });
  render(<CreateActivityForm timeZone="Asia/Shanghai" />);
  await user.type(screen.getByLabelText("活动名称"), "周末露营");
  await user.clear(screen.getByLabelText("开始日期"));
  await user.type(screen.getByLabelText("开始日期"), "2026-08-27");
  await user.click(screen.getByRole("button", { name: "创建活动" }));
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/activities",
    expect.objectContaining({ method: "POST" }),
  );
  expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({
    baseCurrency: "CNY",
  });
  expect(assign).toHaveBeenCalledWith("http://localhost/activities/a1");
});
