// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const theme = vi.hoisted(() => ({ updateThemePreference: vi.fn() }));

vi.mock("@/components/design-system/theme-provider", () => ({
  useThemePreference: () => theme,
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
