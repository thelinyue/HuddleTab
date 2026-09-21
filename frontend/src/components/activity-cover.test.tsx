import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ACTIVITY_COVER_GROUPS,
  ACTIVITY_COVER_PRESETS,
  ActivityCover,
} from "./activity-cover";

describe("ActivityCover", () => {
  it("公开十二张封面并按现有场景和渐变主题分组", () => {
    expect(ACTIVITY_COVER_PRESETS).toHaveLength(12);
    expect(ACTIVITY_COVER_GROUPS.map((group) => group.presets)).toEqual([
      [1, 2, 3, 4, 5, 6],
      [7, 8, 9, 10, 11, 12],
    ]);
  });

  it("自定义封面加载失败时回退到活动主题", () => {
    const { container } = render(
      <ActivityCover activityId="activity-1" coverPreset={12} coverImageId="image-1" />,
    );
    const image = container.querySelector("img")!;
    expect(image).toHaveAttribute("src", "/api/activities/activity-1/cover/image-1");
    fireEvent.error(image);
    expect(image).toHaveAttribute("src", "/activity-covers/cover-12.webp");
  });
});
