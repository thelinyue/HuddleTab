// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ setupRequired: vi.fn() }));

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/server/services/setup-status-service", () => ({
  isSetupRequired: mocks.setupRequired,
}));

import LoginPage from "@/app/login/page";
import RegisterPage from "@/app/register/page";

afterEach(cleanup);

beforeEach(() => {
  mocks.setupRequired.mockResolvedValue(false);
});

test("登录页提供注册入口", async () => {
  render(await LoginPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByText("HuddleTab")).toBeVisible();
  expect(screen.getByText("还没有账号？")).toBeVisible();
  expect(
    document.querySelector('img[src*="auth-hero.webp"]'),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "注册新账号" })).toHaveAttribute(
    "href",
    "/register",
  );
});

test("注册页提供登录入口", async () => {
  render(await RegisterPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByText("HuddleTab")).toBeVisible();
  expect(
    document.querySelector('img[src*="auth-hero.webp"]'),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "已有账号，登录" })).toHaveAttribute(
    "href",
    "/login",
  );
});
