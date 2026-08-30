import { describe, expect, test } from "vitest";

import { parseJoinInvitationUrl } from "@/features/invitations/join-url";

const origin = "https://app.example.test";
const token = "a".repeat(32);

describe("parseJoinInvitationUrl", () => {
  test.each([
    [`${origin}/join/${token}`, `/join/${token}`],
    [`/join/${token}`, `/join/${token}`],
  ])("接受同源邀请路径 %s", (input, expected) => {
    expect(parseJoinInvitationUrl(input, origin)).toBe(expected);
  });

  test.each([
    `https://evil.example/join/${token}`,
    `/activity/${token}`,
    `/join/short`,
    `/join/${"a".repeat(129)}`,
    `/join/${token}!`,
    `/join/${token}?next=/activities`,
    `/join/${token}#details`,
    "",
  ])("拒绝不符合约束的输入 %s", (input) => {
    expect(parseJoinInvitationUrl(input, origin)).toBeNull();
  });
});
