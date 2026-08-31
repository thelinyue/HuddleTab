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

test("活动头使用白色框架并始终展示带人数的成员入口", () => {
  render(
    <ActivityPageHeader
      activityId="activity-1"
      name="日本大阪之旅"
      startDate="2026-08-20"
      endDate="2026-08-22"
      memberCount={1}
      status="ACTIVE"
    />,
  );
  const header = screen.getByRole("banner", { name: "活动信息" });
  expect(header).toHaveClass(
    "bg-surface",
    "-mx-4",
    "px-4",
    "min-[481px]:-mx-6",
    "min-[481px]:px-6",
  );
  expect(header).not.toHaveClass("bg-[#F8FBF6]");
  const members = screen.getByRole("link", { name: "查看成员，1人" });
  expect(members).toHaveClass("min-h-11");
  expect(members).toHaveTextContent("成员 1");
  expect(members.querySelector(".lucide-users-round")).toBeInTheDocument();
  expect(members).toHaveAttribute(
    "href",
    "/activities/activity-1?panel=members",
  );
  expect(
    screen.queryByRole("link", { name: "邀请成员" }),
  ).not.toBeInTheDocument();
});

test.each(["ACTIVE", "ENDED", "ARCHIVED"] as const)(
  "%s 活动的成员入口保持可见",
  (status) => {
    render(
      <ActivityPageHeader
        activityId="activity-1"
        name="日本大阪之旅"
        startDate="2026-08-20"
        endDate="2026-08-22"
        memberCount={1}
        status={status}
      />,
    );
    expect(screen.getByRole("link", { name: "查看成员，1人" })).toBeVisible();
  },
);

test("结算视图的成员入口保留当前 Tab 查询参数", () => {
  render(
    <ActivityPageHeader
      activityId="activity-1"
      name="日本大阪之旅"
      startDate="2026-08-20"
      endDate="2026-08-22"
      memberCount={2}
      status="ACTIVE"
      activeTab="settlement"
    />,
  );
  expect(screen.getByRole("link", { name: "查看成员，2人" })).toHaveAttribute(
    "href",
    "/activities/activity-1?tab=settlement&panel=members",
  );
});
