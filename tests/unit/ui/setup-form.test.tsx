// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { SetupForm } from "@/features/setup/components/setup-form";

afterEach(() => {
  cleanup();
});

test("管理员初始化表单校验确认密码并以无 Token 载荷提交", async () => {
  const user = userEvent.setup();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { initialized: true } }), {
        status: 201,
      }),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
  const assign = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { assign, origin: "http://localhost" });

  render(<SetupForm />);
  await user.type(screen.getByLabelText("管理员昵称"), "管理员");
  await user.type(screen.getByLabelText("用户名"), "admin");
  await user.type(
    screen.getByLabelText("密码", { exact: true }),
    "password123",
  );
  await user.type(screen.getByLabelText("确认密码"), "different-password");
  await user.click(screen.getByRole("button", { name: "完成初始化" }));

  expect(screen.getByRole("alert")).toHaveTextContent("两次输入的密码不一致。");
  expect(fetchMock).not.toHaveBeenCalled();

  await user.clear(screen.getByLabelText("确认密码"));
  await user.type(screen.getByLabelText("确认密码"), "password123");
  await user.click(screen.getByRole("button", { name: "完成初始化" }));

  expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nickname: "管理员",
      username: "admin",
      password: "password123",
    }),
  });
  expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/auth/sign-in/username", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "password123" }),
  });
  expect(assign).toHaveBeenCalledWith("http://localhost/activities");
});

test("初始化已完成后重提交会继续自动登录", async () => {
  const user = userEvent.setup();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: { code: "SETUP_COMPLETED", message: "管理员已初始化。" },
        }),
        { status: 409 },
      ),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
  const assign = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { assign, origin: "http://localhost" });

  render(<SetupForm />);
  await user.type(screen.getByLabelText("管理员昵称"), "管理员");
  await user.type(screen.getByLabelText("用户名"), "admin");
  await user.type(
    screen.getByLabelText("密码", { exact: true }),
    "password123",
  );
  await user.type(screen.getByLabelText("确认密码"), "password123");
  await user.click(screen.getByRole("button", { name: "完成初始化" }));

  expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/auth/sign-in/username", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "password123" }),
  });
  expect(assign).toHaveBeenCalledWith("http://localhost/activities");
});
