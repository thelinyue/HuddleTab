// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
  vi.unstubAllGlobals();
});

test("个人页以真实资料展示身份头像，并只保留已有账户能力", async () => {
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

  expect(await screen.findByRole("img", { name: "林樾的头像" })).toBeVisible();
  expect(screen.getByText("林樾")).toBeVisible();
  expect(screen.getByText("@linyue")).toBeVisible();
  expect(screen.getByText("邮箱已绑定")).toBeVisible();
  expect(screen.getByRole("link", { name: "系统管理" })).toHaveAttribute(
    "href",
    "/admin",
  );
  expect(screen.getByRole("button", { name: "退出登录" })).toBeVisible();
  expect(screen.getByText("HuddleTab V1")).toBeVisible();
  expect(
    screen.queryByRole("link", { name: /帮助|数据管理/ }),
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
