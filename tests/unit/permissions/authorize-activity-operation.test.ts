import { describe, expect, it } from "vitest";

import { evaluateActivityOperation } from "@/server/permissions/authorize-activity-operation";

const base = {
  hasSession: true,
  membershipExists: true,
  lifecycle: "ACTIVE",
  memberStatus: "ACTIVE",
  role: "MEMBER",
  ownsResource: true,
} as const;

describe("活动权限固定判断顺序", () => {
  it("依次检查 Session、成员资格、活动状态和成员状态", () => {
    expect(() =>
      evaluateActivityOperation(
        { ...base, hasSession: false },
        "EXPENSE_CREATE",
      ),
    ).toThrowError(expect.objectContaining({ code: "UNAUTHENTICATED" }));
    expect(() =>
      evaluateActivityOperation(
        { ...base, membershipExists: false },
        "EXPENSE_CREATE",
      ),
    ).toThrowError(expect.objectContaining({ code: "ACTIVITY_NOT_FOUND" }));
    expect(() =>
      evaluateActivityOperation(
        { ...base, lifecycle: "ARCHIVED" },
        "EXPENSE_CREATE",
      ),
    ).toThrowError(expect.objectContaining({ code: "ACTIVITY_READ_ONLY" }));
    expect(() =>
      evaluateActivityOperation(
        { ...base, memberStatus: "LEFT" },
        "EXPENSE_CREATE",
      ),
    ).toThrowError(expect.objectContaining({ code: "LEFT_MEMBER_READ_ONLY" }));
  });

  it("仅允许 LEFT 成员记录付款人为本人且由本人创建的结算", () => {
    const left = {
      ...base,
      lifecycle: "ENDED",
      memberStatus: "LEFT",
      payerIsSelf: true,
      createdBySelf: true,
    } as const;

    expect(() =>
      evaluateActivityOperation(left, "SETTLEMENT_CREATE"),
    ).not.toThrow();
    expect(() =>
      evaluateActivityOperation(
        { ...left, payerIsSelf: false },
        "SETTLEMENT_CREATE",
      ),
    ).toThrowError(
      expect.objectContaining({ code: "SETTLEMENT_PAYER_MUST_BE_SELF" }),
    );
    expect(() =>
      evaluateActivityOperation(
        { ...left, createdBySelf: false },
        "SETTLEMENT_UPDATE",
      ),
    ).toThrowError(expect.objectContaining({ code: "RESOURCE_NOT_OWNED" }));
  });
});
