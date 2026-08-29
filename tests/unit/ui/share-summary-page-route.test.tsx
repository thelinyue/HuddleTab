// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ loader: vi.fn() }));

vi.mock(
  "@/features/settlements/share-summary/components/share-summary-loader",
  () => ({
    ShareSummaryLoader: (props: unknown) => {
      mocks.loader(props);
      return <p>分享摘要加载器</p>;
    },
  }),
);

import ShareSummaryRoute from "@/app/share-summary/[activityId]/page";

afterEach(() => {
  vi.clearAllMocks();
});

test("独立分享路由把活动 ID 交给真实数据加载器", async () => {
  render(
    await ShareSummaryRoute({
      params: Promise.resolve({ activityId: "activity-actual" }),
    }),
  );

  expect(screen.getByText("分享摘要加载器")).toBeVisible();
  expect(mocks.loader).toHaveBeenCalledWith({
    activityId: "activity-actual",
  });
  expect(
    document.querySelector("[data-activity-id='activity-actual']"),
  ).toBeInTheDocument();
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
