// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("@/features/expenses/components/quick-expense-trigger", () => ({
  QuickExpenseTrigger: ({
    onQueued,
  }: {
    readonly onQueued?: (mutationId: string) => void;
  }) => (
    <button type="button" onClick={() => onQueued?.("mutation-1")}>
      模拟离线入队
    </button>
  ),
}));

import { ExpenseFeed } from "@/features/expenses/components/expense-feed";

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("离线入队不触发服务端流水刷新", async () => {
  const user = userEvent.setup();
  const onExpenseSaved = vi.fn();
  const onExpenseQueued = vi.fn();
  render(
    <ExpenseFeed
      activity={{
        id: "activity-1",
        name: "周末露营",
        currency: "CNY",
        totalExpenseMinor: "0",
        originalCurrencyTotals: [],
        startDate: null,
        endDate: null,
        memberCount: 1,
        currentUserBalanceMinor: "0",
      }}
      expenses={[]}
      entryContext={
        {
          activity: { status: "ACTIVE" },
          permissions: { canCreateExpense: true },
        } as never
      }
      onExpenseSaved={onExpenseSaved}
      onExpenseQueued={onExpenseQueued}
    />,
  );

  await user.click(screen.getByRole("button", { name: "模拟离线入队" }));

  expect(onExpenseQueued).toHaveBeenCalledWith("mutation-1");
  expect(onExpenseSaved).not.toHaveBeenCalled();
});
