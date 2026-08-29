// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import ShareSummaryRoute from "@/app/share-summary/[activityId]/page";

test("独立分享路由仅渲染固定的浅色结算长图", async () => {
  render(
    await ShareSummaryRoute({
      params: Promise.resolve({ activityId: "activity-preview" }),
    }),
  );

  expect(document.getElementById("share-summary-card")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "北京之旅" })).toBeVisible();
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
