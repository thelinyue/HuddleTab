// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { ActivitySummaryPage } from "@/features/activities/components/activity-summary-page";

test("结算摘要展示账务信息并可复制", async () => {
  const user = userEvent.setup();
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });

  render(
    <ActivitySummaryPage
      data={{
        activityName: "杭州周末露营",
        startDate: "2026-08-29",
        endDate: null,
        memberCount: 3,
        totalExpenseMinor: "50050",
        currency: "CNY",
        currentUserBalanceMinor: "6966",
        originalCurrencyTotals: [{ currency: "CNY", amountMinor: "50050" }],
        balances: [
          { memberId: "m1", displayName: "王管理员", netMinor: "6966" },
        ],
        recommendations: [],
        categoryTotals: [{ category: "FOOD", amountMinor: "50050" }],
      }}
    />,
  );

  expect(screen.getByRole("heading", { name: "结算摘要" })).toBeVisible();
  expect(screen.getByText("杭州周末露营")).toBeVisible();
  expect(screen.getByText("¥500.50")).toHaveAttribute(
    "data-money-tone",
    "neutral",
  );
  expect(
    screen
      .getAllByText("¥69.66")
      .some(
        (element) => element.getAttribute("data-money-tone") === "receivable",
      ),
  ).toBe(true);
  await user.click(screen.getByRole("button", { name: "复制摘要" }));
  expect(writeText).toHaveBeenCalledWith(
    expect.stringContaining("杭州周末露营"),
  );
});
