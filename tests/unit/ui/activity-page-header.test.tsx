// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { ActivityPageHeader } from "@/features/activities/components/activity-page-header";

afterEach(cleanup);

test.each([
  ["ENDED", "活动已结束", "仍可查看流水并记录实际结算"],
  ["ARCHIVED", "活动已归档", "当前活动仅供查看"],
] as const)(
  "%s 活动在页签后显示明确的操作边界",
  (status, title, description) => {
    render(
      <ActivityPageHeader
        activityId="activity-1"
        name="日本大阪之旅"
        startDate="2026-08-20"
        endDate="2026-08-22"
        memberCount={4}
        status={status}
      />,
    );

    const notice = screen.getByRole("region", { name: title });
    expect(notice).toHaveTextContent(title);
    expect(notice).toHaveTextContent(description);
  },
);
