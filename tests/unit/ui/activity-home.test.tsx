// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { ActivityHome } from "@/features/activities/components/activity-home";

test("跨活动应收应付不抵消，并按生命周期分组", () => {
  render(
    <ActivityHome
      data={{
        summaries: [
          {
            payableMinor: "3000",
            receivableMinor: "5000",
            currency: "CNY",
          },
        ],
        active: [
          { id: "a", name: "杭州旅行", status: "ACTIVE", myNetMinor: "-3000" },
        ],
        ended: [
          { id: "b", name: "周末露营", status: "ENDED", myNetMinor: "5000" },
        ],
        archived: [],
      }}
    />,
  );

  expect(screen.getByText("待支付")).toBeVisible();
  expect(screen.getByText("¥30.00")).toBeVisible();
  expect(screen.getByText("待收款")).toBeVisible();
  expect(screen.getByText("¥50.00")).toBeVisible();
  expect(screen.getByRole("heading", { name: "进行中" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "最近结束" })).toBeVisible();
});
