// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import LoginPage from "@/app/login/page";
import RegisterPage from "@/app/register/page";

afterEach(cleanup);

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
