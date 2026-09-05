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

test("活动进行中且当前用户可管理成员时展示 44px 邀请入口", () => {
  render(
    <ActivityPageHeader
      activityId="activity-1"
      name="日本大阪之旅"
      startDate="2026-08-20"
      endDate="2026-08-22"
      memberCount={1}
      status="ACTIVE"
      canManageMembers
    />,
  );
  const invite = screen.getByRole("link", { name: "邀请成员" });
  expect(invite).toHaveClass("size-11");
  expect(invite).toHaveAttribute(
    "href",
    "/activities/activity-1?panel=members",
  );
  expect(screen.getByRole("link", { name: /查看成员/ })).toHaveClass(
    "min-h-11",
  );
});

test.each(["ENDED", "ARCHIVED"] as const)(
  "%s 活动不展示邀请管理入口",
  (status) => {
    render(
      <ActivityPageHeader
        activityId="activity-1"
        name="日本大阪之旅"
        startDate="2026-08-20"
        endDate="2026-08-22"
        memberCount={1}
        status={status}
        canManageMembers
      />,
    );
    expect(
      screen.queryByRole("link", { name: "邀请成员" }),
    ).not.toBeInTheDocument();
  },
);

test("活动进行中但普通成员不可见邀请管理入口", () => {
  render(
    <ActivityPageHeader
      activityId="activity-1"
      name="日本大阪之旅"
      startDate="2026-08-20"
      endDate="2026-08-22"
      memberCount={2}
      status="ACTIVE"
      canManageMembers={false}
    />,
  );
  expect(
    screen.queryByRole("link", { name: "邀请成员" }),
  ).not.toBeInTheDocument();
});
