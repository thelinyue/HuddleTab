// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

const router = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

import { MePage } from "@/features/me/components/me-page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

test("个人页使用真实账户路由组织资料与设置，并保留主页退出登录", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          nickname: "林樾",
          username: "linyue",
          emailBound: true,
          maskedEmail: "l***@example.com",
          emailVerified: true,
          avatarPreset: null,
          themePreference: "SYSTEM",
          isSystemAdmin: true,
        },
      }),
    }),
  );

  render(<MePage />);

  expect(await screen.findByRole("heading", { name: "我的" })).toBeVisible();
  expect(await screen.findByRole("img", { name: "林樾的头像" })).toBeVisible();
  expect(screen.getByText("林樾")).toBeVisible();
  expect(
    within(screen.getByRole("region", { name: "个人资料" })).getByText(
      "@linyue",
    ),
  ).toBeVisible();
  expect(screen.getByText("已绑定")).toBeVisible();
  expect(screen.getByRole("heading", { name: "账户与安全" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "偏好设置" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "管理" })).toBeVisible();
  expect(screen.getByRole("link", { name: "个人资料" })).toHaveAttribute(
    "href",
    "/me/profile",
  );
  expect(screen.getByRole("link", { name: "邮箱" })).toHaveAttribute(
    "href",
    "/me/email",
  );
  expect(screen.getByRole("link", { name: "修改密码" })).toHaveAttribute(
    "href",
    "/me/password",
  );
  expect(
    screen.getByRole("link", { name: "主题：跟随系统" }),
  ).toHaveAttribute("href", "/me/theme");
  expect(screen.getByRole("link", { name: "系统管理" })).toHaveAttribute(
    "href",
    "/admin",
  );
  expect(screen.getByRole("button", { name: "退出登录" })).toBeVisible();
  expect(screen.queryByLabelText("昵称")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("dialog", { name: "编辑个人资料" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("HuddleTab V1")).toBeVisible();
  expect(
    screen.queryByRole("link", { name: /帮助|数据管理/ }),
  ).not.toBeInTheDocument();
});

test("非系统管理员不展示系统管理入口", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          nickname: "林樾",
          username: "linyue",
          emailBound: false,
          maskedEmail: null,
          emailVerified: false,
          avatarPreset: null,
          themePreference: "SYSTEM",
          isSystemAdmin: false,
        },
      }),
    }),
  );

  render(<MePage />);

  await screen.findByRole("heading", { name: "我的" });
  expect(screen.queryByRole("heading", { name: "管理" })).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "系统管理" }),
  ).not.toBeInTheDocument();
});

test("退出登录成功后通过 App Router 替换到登录页", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      data: {
        nickname: "林樾",
        username: "linyue",
        emailBound: true,
        themePreference: "SYSTEM",
        isSystemAdmin: false,
      },
    }),
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<MePage />);
  await user.click(await screen.findByRole("button", { name: "退出登录" }));

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/sign-out", {
      method: "POST",
    });
    expect(router.replace).toHaveBeenCalledWith("/login");
  });
});
