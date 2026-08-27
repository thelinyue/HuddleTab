// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { AccountForm } from "@/features/auth/components/account-form";

afterEach(() => cleanup());

test("登录提交用户名和密码后进入活动页", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  const assign = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { assign, origin: "http://localhost" });

  render(<AccountForm mode="login" />);
  await user.type(screen.getByLabelText("用户名"), "alice");
  await user.type(screen.getByLabelText("密码"), "password123");
  await user.click(screen.getByRole("button", { name: "登录" }));

  expect(fetchMock).toHaveBeenCalledWith("/api/auth/sign-in/username", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "alice", password: "password123" }),
  });
  expect(assign).toHaveBeenCalledWith("http://localhost/activities");
});

test("注册后自动登录且不提交确认密码", async () => {
  const user = userEvent.setup();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response("{}", { status: 201 }))
    .mockResolvedValueOnce(new Response("{}", { status: 200 }));
  const assign = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { assign, origin: "http://localhost" });

  render(<AccountForm mode="register" />);
  await user.type(screen.getByLabelText("昵称"), "小王");
  await user.type(screen.getByLabelText("用户名"), "wang");
  await user.type(screen.getByLabelText("密码"), "password123");
  await user.type(screen.getByLabelText("确认密码"), "password123");
  await user.type(screen.getByLabelText("邀请凭证（受邀注册时填写）"), "proof");
  await user.click(screen.getByRole("button", { name: "注册" }));

  expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname: "小王", username: "wang", password: "password123", inviteProof: "proof" }),
  });
  expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/auth/sign-in/username", expect.any(Object));
  expect(assign).toHaveBeenCalledWith("http://localhost/activities");
});

test("注册确认密码不一致时不发起请求", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  render(<AccountForm mode="register" />);
  await user.type(screen.getByLabelText("昵称"), "小王");
  await user.type(screen.getByLabelText("用户名"), "wang");
  await user.type(screen.getByLabelText("密码"), "password123");
  await user.type(screen.getByLabelText("确认密码"), "different123");
  await user.click(screen.getByRole("button", { name: "注册" }));

  expect(screen.getByRole("alert")).toHaveTextContent("两次输入的密码不一致。");
  expect(fetchMock).not.toHaveBeenCalled();
});
