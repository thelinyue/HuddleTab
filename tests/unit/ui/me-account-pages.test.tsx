// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

const api = vi.hoisted(() => ({ getMeProfile: vi.fn() }));
const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
const theme = vi.hoisted(() => ({
  preference: "SYSTEM" as const,
  updateThemePreference: vi.fn(),
  applyThemePreference: vi.fn(),
}));
const productTheme = vi.hoisted(() => ({
  loading: false,
  preference: "SYSTEM" as "SYSTEM" | "LIGHT" | "DARK" | null,
  commitPreference: vi.fn(),
}));

vi.mock("@/features/me/api", () => api);
vi.mock("@/components/design-system/theme-provider", () => ({
  useThemePreference: () => theme,
}));
vi.mock("@/features/me/components/product-theme-sync", () => ({
  useProductThemeSync: () => productTheme,
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { EmailPage } from "@/features/me/components/email-page";
import { PasswordPage } from "@/features/me/components/password-page";
import { ThemePage } from "@/features/me/components/theme-page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function mockProfile(overrides: Partial<Record<string, unknown>> = {}) {
  productTheme.preference =
    (overrides.themePreference as typeof productTheme.preference) ?? "SYSTEM";
  api.getMeProfile.mockResolvedValue({
    nickname: "林樾",
    username: "linyue",
    emailBound: false,
    maskedEmail: null,
    emailVerified: false,
    avatarPreset: null,
    themePreference: "SYSTEM",
    isSystemAdmin: false,
    ...overrides,
  });
}

test("未绑定邮箱时显示绑定入口且不展示合成邮箱", async () => {
  mockProfile();

  render(<EmailPage />);

  expect(await screen.findByRole("heading", { name: "邮箱" })).toBeVisible();
  expect(screen.getByRole("button", { name: "绑定邮箱" })).toBeVisible();
  expect(screen.getByText("用于账户安全和找回。")).toBeVisible();
  expect(screen.queryByText(/Synthetic Email/i)).not.toBeInTheDocument();
  expect(screen.queryByText("已验证")).not.toBeInTheDocument();
});

test("已绑定邮箱使用服务端脱敏值和真实验证状态，并提供更换入口", async () => {
  mockProfile({
    emailBound: true,
    maskedEmail: "l***@example.com",
    emailVerified: false,
  });

  render(<EmailPage />);

  expect(await screen.findByText("l***@example.com")).toBeVisible();
  expect(screen.getByText("未验证")).toBeVisible();
  expect(screen.queryByText("已验证")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "更换邮箱" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "退出登录" }),
  ).not.toBeInTheDocument();
  expect(document.querySelector('a[href="/me/theme"]')).not.toBeInTheDocument();
});

test("新密码与确认密码不一致时不提交并显示中文错误", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  render(<PasswordPage />);

  await user.type(screen.getByLabelText("当前密码"), "old-password");
  await user.type(screen.getByLabelText("新密码"), "new-password");
  await user.type(screen.getByLabelText("确认新密码"), "other-password");
  await user.click(screen.getByRole("button", { name: "确认修改" }));

  expect(screen.getByRole("alert")).toHaveTextContent(
    "新密码与确认密码不一致。",
  );
  expect(screen.getByLabelText("新密码")).toHaveAttribute(
    "aria-describedby",
    "password-error",
  );
  expect(screen.getByLabelText("确认新密码")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(fetchMock).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: "退出登录" }),
  ).not.toBeInTheDocument();
  expect(document.querySelector('a[href="/me/theme"]')).not.toBeInTheDocument();
});

test("密码一致时提交现有密码接口所需字段", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchMock);

  render(<PasswordPage />);

  await user.type(screen.getByLabelText("当前密码"), "old-password");
  await user.type(screen.getByLabelText("新密码"), "new-password");
  await user.type(screen.getByLabelText("确认新密码"), "new-password");
  await user.click(screen.getByRole("button", { name: "确认修改" }));

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith("/api/me/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: "old-password",
        newPassword: "new-password",
      }),
    });
  });
  expect(await screen.findByRole("status")).toHaveTextContent("密码已修改。");
});

test("主题页展示壳层已同步的服务器偏好且不重复应用或提交", async () => {
  mockProfile({ themePreference: "DARK" });

  render(<ThemePage />);

  expect(await screen.findByRole("radio", { name: "暗色" })).toBeChecked();
  expect(theme.applyThemePreference).not.toHaveBeenCalled();
  expect(theme.updateThemePreference).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: "退出登录" }),
  ).not.toBeInTheDocument();
  expect(document.querySelector('a[href="/me/theme"]')).not.toBeInTheDocument();
});

test("主题保存成功后才更新本地主题", async () => {
  const user = userEvent.setup();
  let resolveUpdate: (() => void) | undefined;
  theme.updateThemePreference.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        resolveUpdate = resolve;
      }),
  );

  mockProfile();
  render(<ThemePage />);

  await user.click(await screen.findByRole("radio", { name: "暗色" }));
  expect(theme.updateThemePreference).toHaveBeenCalledWith("DARK");
  expect(screen.getByRole("radio", { name: "跟随系统" })).toBeChecked();
  resolveUpdate?.();

  await waitFor(() => {
    expect(screen.getByRole("radio", { name: "暗色" })).toBeChecked();
  });
});
