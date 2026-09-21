import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AVATAR_PRESETS, MemberAvatar } from "./member-avatar";

describe("MemberAvatar", () => {
  it("公开六张人物和五张动物头像", () => {
    expect(AVATAR_PRESETS).toHaveLength(11);
  });

  it("自定义头像加载失败时回退到用户默认头像", () => {
    const { container } = render(
      <MemberAvatar
        memberId="member-1"
        userId="user-1"
        displayName="测试用户"
        avatarPreset={7}
        avatarImageId="image-1"
      />,
    );
    const image = container.querySelector("img")!;
    expect(image).toHaveAttribute("src", "/api/users/user-1/avatar/image-1");
    fireEvent.error(image);
    expect(image).toHaveAttribute("src", "/member-avatars/avatar-07.webp");
  });
});
