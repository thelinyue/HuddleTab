import { describe, expect, it } from "vitest";
import { invitationRequest } from "./api";

describe("invitationRequest", () => {
  it("将链接邀请映射为不限次数的 LINK 请求", () => {
    expect(invitationRequest({ mode: "link" })).toEqual({
      kind: "LINK",
      maxUses: null,
      targetUsername: null,
    });
  });

  it("将定向邀请映射为指定用户名的一次性 DIRECT 请求", () => {
    expect(invitationRequest({ mode: "direct", targetUsername: "invitee" })).toEqual({
      kind: "DIRECT",
      maxUses: 1,
      targetUsername: "invitee",
    });
  });
});
