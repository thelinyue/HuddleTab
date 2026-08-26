// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { BottomNavigation } from "@/components/design-system/bottom-navigation";

test("一级导航只有活动、通知、我的，并提供当前项语义", () => {
  render(<BottomNavigation current="activities" unreadCount={3} />);

  expect(screen.getAllByRole("link")).toHaveLength(3);
  expect(screen.getByRole("link", { name: "活动" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByRole("link", { name: /通知，3 条未读/ })).toBeVisible();
});
