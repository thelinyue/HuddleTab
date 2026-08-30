// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { CreateActivityForm } from "@/features/activities/components/create-activity-form";

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
  render(<CreateActivityForm />);
  await user.type(screen.getByLabelText("活动名称"), "周末露营");
  await user.clear(screen.getByLabelText("开始日期"));
  await user.type(screen.getByLabelText("开始日期"), "2026-08-27");
  await user.click(screen.getByRole("button", { name: "创建活动" }));
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/activities",
    expect.objectContaining({ method: "POST" }),
  );
  expect(assign).toHaveBeenCalledWith("http://localhost/activities/a1");
});
