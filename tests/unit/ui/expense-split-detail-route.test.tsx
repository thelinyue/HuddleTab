// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("@/features/expenses/components/expense-loaders", () => ({
  ExpenseSplitDetailLoader: () => <p>分摊明细路由</p>,
}));

import ExpenseSplitDetailPage from "@/app/(product)/activities/[activityId]/expenses/[expenseId]/split/page";

afterEach(cleanup);

test("分摊明细深链接渲染只读加载器", () => {
  render(<ExpenseSplitDetailPage />);
  expect(screen.getByText("分摊明细路由")).toBeVisible();
});
