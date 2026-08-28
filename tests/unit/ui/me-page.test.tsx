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

const theme = vi.hoisted(() => ({ updateThemePreference: vi.fn() }));
const router = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("@/components/design-system/theme-provider", () => ({
  useThemePreference: () => theme,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

import { MePage } from "@/features/me/components/me-page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

test("个人页使用品牌资料头和轻量分组行展示已有账户能力", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          nickname: "林樾",
          username: "linyue",
          emailBound: true,
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
  expect(screen.getByRole("button", { name: "编辑个人资料" })).toBeVisible();
  expect(screen.getByRole("button", { name: "修改密码" })).toBeVisible();
  expect(screen.getByRole("button", { name: "主题：跟随系统" })).toBeVisible();
  expect(screen.getByRole("link", { name: "系统管理" })).toHaveAttribute(
    "href",
    "/admin",
  );
  expect(screen.getByRole("button", { name: "退出登录" })).toBeVisible();
  expect(screen.queryByLabelText("昵称")).not.toBeInTheDocument();
  expect(screen.getByText("HuddleTab V1")).toBeVisible();
  expect(
    screen.queryByRole("link", { name: /帮助|数据管理/ }),
  ).not.toBeInTheDocument();
});

test("昵称编辑在 Overlay 内保存并更新资料头", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    if (input === "/api/me/profile" && !init?.method) {
      return Promise.resolve({
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
    }
    return Promise.resolve({ ok: true });
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<MePage />);

  await user.click(await screen.findByRole("button", { name: "编辑个人资料" }));
  expect(screen.getByRole("dialog", { name: "编辑个人资料" })).toBeVisible();
  const nickname = screen.getByLabelText("昵称");
  await user.clear(nickname);
  await user.type(nickname, "新昵称");
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(fetchMock).toHaveBeenCalledWith("/api/me/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname: "新昵称" }),
  });
  await waitFor(() => {
    expect(
      screen.queryByRole("dialog", { name: "编辑个人资料" }),
    ).not.toBeInTheDocument();
  });
  expect(screen.getByText("新昵称")).toBeVisible();
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
