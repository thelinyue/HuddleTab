// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { CirclePlusIcon } from "lucide-react";
import { describe, expect, it } from "vitest";

import { buttonVariants } from "@/components/ui/button";
import { ActivityCover } from "@/components/design-system/activity-cover";
import { EmptyState } from "@/components/design-system/empty-state";
import { MemberAvatar } from "@/components/design-system/member-avatar";

describe("基础交互组件", () => {
  it("keeps the default button at the mobile minimum touch target", () => {
    expect(buttonVariants()).toContain("min-h-11");
  });

  it("uses an accessible Unicode-name avatar fallback with a stable member mapping", () => {
    const { rerender } = render(
      createElement(MemberAvatar, {
        memberId: "member-42",
        displayName: "  小王  ",
      }),
    );

    const avatar = screen.getByLabelText("小王的头像");
    expect(avatar).toHaveTextContent("小");
    const colorIndex = avatar.getAttribute("data-avatar-color-index");

    rerender(
      createElement(MemberAvatar, {
        memberId: "member-42",
        displayName: "访客",
      }),
    );
    expect(screen.getByLabelText("访客的头像")).toHaveAttribute(
      "data-avatar-color-index",
      colorIndex,
    );
  });

  it("keeps fallback covers decorative when their activity title is visible", () => {
    const { rerender } = render(
      createElement(ActivityCover, {
        activityId: "activity-42",
        activityName: "周末露营",
      }),
    );

    const cover = screen.getByRole("presentation");
    expect(cover).toHaveAttribute(
      "src",
      expect.stringMatching(/^\/activity-covers\/cover-0[1-6]\.webp$/),
    );
    const source = cover.getAttribute("src");

    rerender(
      createElement(ActivityCover, {
        activityId: "activity-42",
        activityName: "春游",
      }),
    );
    expect(screen.getByRole("presentation")).toHaveAttribute("src", source);
  });

  it("exposes empty-state content and its optional action semantically", () => {
    render(
      createElement(EmptyState, {
        icon: CirclePlusIcon,
        title: "还没有消费",
        description: "添加第一笔消费后会显示在这里。",
        action: createElement("button", { type: "button" }, "添加消费"),
      }),
    );

    expect(screen.getByRole("heading", { name: "还没有消费" })).toBeVisible();
    expect(screen.getByText("添加第一笔消费后会显示在这里。")).toBeVisible();
    expect(screen.getByRole("button", { name: "添加消费" })).toBeVisible();
  });
});
