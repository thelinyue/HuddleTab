// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

import { JoinActivityForm } from "@/features/activities/components/join-activity-form";

const token = "a".repeat(32);

beforeEach(() => {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { readText: vi.fn() },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("支持手动输入同源邀请链接并跳转到现有加入页", async () => {
  const user = userEvent.setup();
  render(<JoinActivityForm />);
  await user.type(
    screen.getByRole("textbox", { name: "邀请链接" }),
    `/join/${token}`,
  );
  await user.click(screen.getByRole("button", { name: "继续加入" }));
  expect(mocks.push).toHaveBeenCalledWith(`/join/${token}`);
});

test("剪贴板读取成功后填入邀请链接，失败时保留手动回退", async () => {
  const user = userEvent.setup();
  const readText = vi.fn().mockResolvedValue(`/join/${token}`);
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { readText },
  });
  render(<JoinActivityForm />);
  await user.click(screen.getByRole("button", { name: "从剪贴板读取" }));
  expect(await screen.findByRole("textbox", { name: "邀请链接" })).toHaveValue(
    `/join/${token}`,
  );

  readText.mockRejectedValueOnce(new Error("denied"));
  await user.click(screen.getByRole("button", { name: "从剪贴板读取" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "无法读取剪贴板，请手动粘贴邀请链接。",
  );
});

test("离线时保留输入并禁用继续，不排队加入请求", () => {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value: false,
  });
  render(<JoinActivityForm />);
  expect(screen.getByRole("textbox", { name: "邀请链接" })).toBeVisible();
  expect(screen.getByRole("button", { name: "继续加入" })).toBeDisabled();
  expect(screen.getByText("加入活动需要联网，不会排队。")).toBeVisible();
});
