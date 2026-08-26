// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import {
  BottomNavigation,
  ProductNavigation,
} from "@/components/design-system/bottom-navigation";

vi.mock("next/navigation", () => ({
  usePathname: () => "/activities",
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("一级导航只有活动、通知、我的，并提供当前项语义", () => {
  render(<BottomNavigation current="activities" unreadCount={3} />);

  expect(screen.getAllByRole("link")).toHaveLength(3);
  expect(screen.getByRole("link", { name: "活动" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByRole("link", { name: /通知，3 条未读/ })).toBeVisible();
});

test("一级导航加载服务器未读通知数", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { unreadCount: 2 } }),
    }),
  );

  render(<ProductNavigation />);

  expect(
    await screen.findByRole("link", { name: "通知，2 条未读" }),
  ).toBeVisible();
});
