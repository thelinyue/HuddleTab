// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const profilePage = vi.hoisted(() => vi.fn());
const emailPage = vi.hoisted(() => vi.fn());
const passwordPage = vi.hoisted(() => vi.fn());
const themePage = vi.hoisted(() => vi.fn());

vi.mock("@/features/me/components/profile-page", () => ({
  ProfilePage: () => {
    profilePage();
    return <p>个人资料路由</p>;
  },
}));

vi.mock("@/features/me/components/email-page", () => ({
  EmailPage: () => {
    emailPage();
    return <p>邮箱路由</p>;
  },
}));

vi.mock("@/features/me/components/password-page", () => ({
  PasswordPage: () => {
    passwordPage();
    return <p>密码路由</p>;
  },
}));

vi.mock("@/features/me/components/theme-page", () => ({
  ThemePage: () => {
    themePage();
    return <p>主题路由</p>;
  },
}));

import ProfileRoute from "@/app/(product)/me/profile/page";
import EmailRoute from "@/app/(product)/me/email/page";
import PasswordRoute from "@/app/(product)/me/password/page";
import ThemeRoute from "@/app/(product)/me/theme/page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("个人资料路由渲染资料编辑页面", () => {
  render(<ProfileRoute />);

  expect(screen.getByText("个人资料路由")).toBeVisible();
  expect(profilePage).toHaveBeenCalledTimes(1);
});

test("账户二级路由分别渲染对应页面", () => {
  const { rerender } = render(<EmailRoute />);
  expect(screen.getByText("邮箱路由")).toBeVisible();
  expect(emailPage).toHaveBeenCalledTimes(1);

  rerender(<PasswordRoute />);
  expect(screen.getByText("密码路由")).toBeVisible();
  expect(passwordPage).toHaveBeenCalledTimes(1);

  rerender(<ThemeRoute />);
  expect(screen.getByText("主题路由")).toBeVisible();
  expect(themePage).toHaveBeenCalledTimes(1);
});
