// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import LoginPage from "@/app/login/page";
import RegisterPage from "@/app/register/page";

test("登录页提供注册入口", async () => {
  render(await LoginPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByRole("link", { name: "注册新账号" })).toHaveAttribute(
    "href",
    "/register",
  );
});

test("注册页提供登录入口", async () => {
  render(await RegisterPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByRole("link", { name: "已有账号，登录" })).toHaveAttribute(
    "href",
    "/login",
  );
});
