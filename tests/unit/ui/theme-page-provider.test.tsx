// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import type { ReactNode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

const api = vi.hoisted(() => ({ getMeProfile: vi.fn() }));
const nextTheme = vi.hoisted(() => ({
  theme: "system",
  setTheme: vi.fn(),
}));

vi.mock("@/features/me/api", () => api);
vi.mock("next-themes", () => ({
  ThemeProvider: ({ children }: { readonly children: ReactNode }) => children,
  useTheme: () => nextTheme,
}));

import { ThemeProvider } from "@/components/design-system/theme-provider";
import { ProductThemeSync } from "@/features/me/components/product-theme-sync";
import { ThemePage } from "@/features/me/components/theme-page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

test("主题接口保存失败时真实 Provider 不切换本地主题且页面保留旧值", async () => {
  const user = userEvent.setup();
  api.getMeProfile.mockResolvedValue({
    nickname: "林樾",
    username: "linyue",
    emailBound: false,
    maskedEmail: null,
    emailVerified: false,
    avatarPreset: null,
    themePreference: "DARK",
    isSystemAdmin: false,
  });
  const fetchMock = vi.fn().mockResolvedValue({ ok: false });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <ThemeProvider>
      <ProductThemeSync>
        <ThemePage />
      </ProductThemeSync>
    </ThemeProvider>,
  );

  expect(await screen.findByRole("radio", { name: "暗色" })).toBeChecked();
  expect(api.getMeProfile).toHaveBeenCalledTimes(1);
  expect(nextTheme.setTheme).toHaveBeenCalledWith("dark");
  nextTheme.setTheme.mockClear();

  await user.click(screen.getByRole("radio", { name: "亮色" }));

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith("/api/me/theme", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: "LIGHT" }),
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "主题偏好保存失败，请稍后重试。",
    );
  });
  expect(nextTheme.setTheme).not.toHaveBeenCalled();
  expect(screen.getByRole("radio", { name: "暗色" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "亮色" })).not.toBeChecked();
});
