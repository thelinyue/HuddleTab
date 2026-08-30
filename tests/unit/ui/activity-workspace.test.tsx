// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: "",
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ activityId: "activity-1" }),
  useRouter: () => ({ back: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(mocks.query),
}));
vi.mock("@/features/expenses/components/expense-loaders", () => ({
  ExpenseFeedLoader: () => <p data-testid="feed-loader">流水加载器</p>,
}));
vi.mock("@/features/settlements/components/settlement-page-loader", () => ({
  SettlementPageLoader: () => <p data-testid="settlement-loader">结算加载器</p>,
}));
vi.mock("@/features/members/components/member-page-loader", () => ({
  MemberPageLoader: () => null,
}));
vi.mock("@/features/activities/components/activity-more", () => ({
  ActivityMore: () => null,
}));
vi.mock("@/features/expenses/components/responsive-form-overlay", () => ({
  ResponsiveFormOverlay: ({ children }: { readonly children: ReactNode }) =>
    children,
}));

import { ActivityWorkspace } from "@/features/activities/components/activity-workspace";

afterEach(() => {
  cleanup();
  mocks.query = "";
  vi.clearAllMocks();
});

test("活动工作台以稳定共享 surface 承载两个页签并保留 surface DOM 节点", () => {
  const { rerender } = render(<ActivityWorkspace timeZone="Asia/Shanghai" />);
  const surface = screen.getByTestId("activity-workspace-surface");

  expect(surface).toHaveClass(
    "bg-surface",
    "min-h-dvh",
    "px-4",
    "pt-[calc(1rem+env(safe-area-inset-top))]",
  );
  expect(surface).toHaveAttribute("data-page-reveal", "false");
  expect(screen.getByTestId("feed-loader")).toBeVisible();

  mocks.query = "?tab=settlement";
  rerender(<ActivityWorkspace timeZone="Asia/Shanghai" />);

  expect(screen.getByTestId("activity-workspace-surface")).toBe(surface);
  expect(screen.getByTestId("settlement-loader")).toBeVisible();
});
