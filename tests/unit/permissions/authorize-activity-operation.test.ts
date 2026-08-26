import { expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  authorizeActivityOperation,
  evaluateActivityOperation,
  type ActivityOperation,
  type ActivityPermissionContext,
} from "@/server/permissions/authorize-activity-operation";

const activeMemberContext: ActivityPermissionContext = {
  hasSession: true,
  membershipExists: true,
  lifecycle: "ACTIVE",
  memberStatus: "ACTIVE",
  role: "MEMBER",
  ownsResource: true,
  payerIsSelf: true,
  createdBySelf: true,
};

function context(
  overrides: Partial<ActivityPermissionContext> = {},
): ActivityPermissionContext {
  return { ...activeMemberContext, ...overrides };
}

function expectDenied(
  overrides: Partial<ActivityPermissionContext>,
  operation: ActivityOperation,
  code: string,
  status: 401 | 403 | 404 | 409,
) {
  expect(() =>
    evaluateActivityOperation(context(overrides), operation),
  ).toThrowError(
    expect.objectContaining({
      code,
      message: expect.any(String),
      status,
    }),
  );
}

it("按 session、成员、活动生命周期和离开状态的固定顺序拒绝请求", () => {
  expectDenied(
    {
      hasSession: false,
      membershipExists: false,
      lifecycle: "DELETED",
      memberStatus: "LEFT",
    },
    "EXPENSE_CREATE",
    "UNAUTHENTICATED",
    401,
  );
  expectDenied(
    { membershipExists: false, lifecycle: "DELETED", memberStatus: "LEFT" },
    "EXPENSE_CREATE",
    "ACTIVITY_NOT_FOUND",
    404,
  );
  expectDenied(
    { lifecycle: "DELETED", memberStatus: "LEFT" },
    "EXPENSE_CREATE",
    "ACTIVITY_READ_ONLY",
    409,
  );
  expectDenied(
    { memberStatus: "LEFT" },
    "EXPENSE_CREATE",
    "LEFT_MEMBER_READ_ONLY",
    403,
  );
});

it("ENDED 仅允许结算写入，ARCHIVED 只读，DELETED 永不允许写入", () => {
  expectDenied(
    { lifecycle: "ENDED" },
    "EXPENSE_CREATE",
    "ACTIVITY_READ_ONLY",
    409,
  );
  expect(() =>
    evaluateActivityOperation(
      context({ lifecycle: "ENDED" }),
      "SETTLEMENT_CREATE",
    ),
  ).not.toThrow();
  expectDenied(
    { lifecycle: "ARCHIVED" },
    "SETTLEMENT_CREATE",
    "ACTIVITY_READ_ONLY",
    409,
  );
  expect(() =>
    evaluateActivityOperation(context({ lifecycle: "ARCHIVED" }), "READ"),
  ).not.toThrow();
  expectDenied(
    { lifecycle: "DELETED" },
    "SETTLEMENT_CREATE",
    "ACTIVITY_READ_ONLY",
    409,
  );
});

it("生命周期在 LEFT 限制之前生效", () => {
  expectDenied(
    { lifecycle: "ENDED", memberStatus: "LEFT" },
    "EXPENSE_CREATE",
    "ACTIVITY_READ_ONLY",
    409,
  );
  expectDenied(
    { lifecycle: "ARCHIVED", memberStatus: "LEFT" },
    "SETTLEMENT_CREATE",
    "ACTIVITY_READ_ONLY",
    409,
  );
});

it.each<ActivityOperation>([
  "EXPENSE_CREATE",
  "EXPENSE_UPDATE",
  "EXPENSE_DELETE",
])("LEFT 即使拥有资源也不能执行 %s", (operation) => {
  expectDenied(
    { memberStatus: "LEFT", ownsResource: true },
    operation,
    "LEFT_MEMBER_READ_ONLY",
    403,
  );
});

it.each(["ACTIVE", "LEFT"] as const)(
  "%s MEMBER 创建结算时只能指定自己为付款人",
  (memberStatus) => {
    expectDenied(
      { memberStatus, payerIsSelf: false },
      "SETTLEMENT_CREATE",
      "SETTLEMENT_PAYER_MUST_BE_SELF",
      403,
    );
    expect(() =>
      evaluateActivityOperation(
        context({ memberStatus, payerIsSelf: true }),
        "SETTLEMENT_CREATE",
      ),
    ).not.toThrow();
  },
);

it.each(["OWNER", "ADMIN"] as const)(
  "%s 创建结算可以指定其他成员为付款人",
  (role) => {
    expect(() =>
      evaluateActivityOperation(
        context({ role, payerIsSelf: false }),
        "SETTLEMENT_CREATE",
      ),
    ).not.toThrow();
  },
);

it.each(["OWNER", "ADMIN"] as const)(
  "LEFT %s 创建结算时仍只能指定自己为付款人",
  (role) => {
    expectDenied(
      { memberStatus: "LEFT", role, payerIsSelf: false },
      "SETTLEMENT_CREATE",
      "SETTLEMENT_PAYER_MUST_BE_SELF",
      403,
    );
  },
);

it.each(["SETTLEMENT_UPDATE", "SETTLEMENT_DELETE"] as const)(
  "ACTIVE MEMBER 更新或删除自建结算时只能指定自己为付款人：%s",
  (operation) => {
    expectDenied(
      { ownsResource: true, createdBySelf: true, payerIsSelf: false },
      operation,
      "SETTLEMENT_PAYER_MUST_BE_SELF",
      403,
    );
  },
);

it.each(["SETTLEMENT_UPDATE", "SETTLEMENT_DELETE"] as const)(
  "LEFT 更新或删除结算时付款人检查优先于创建者检查：%s",
  (operation) => {
    expectDenied(
      {
        memberStatus: "LEFT",
        role: "ADMIN",
        ownsResource: false,
        createdBySelf: false,
        payerIsSelf: false,
      },
      operation,
      "SETTLEMENT_PAYER_MUST_BE_SELF",
      403,
    );
    expectDenied(
      {
        memberStatus: "LEFT",
        role: "ADMIN",
        ownsResource: false,
        createdBySelf: false,
        payerIsSelf: true,
      },
      operation,
      "RESOURCE_NOT_OWNED",
      403,
    );
    expect(() =>
      evaluateActivityOperation(
        context({
          memberStatus: "LEFT",
          role: "ADMIN",
          ownsResource: true,
          createdBySelf: true,
          payerIsSelf: true,
        }),
        operation,
      ),
    ).not.toThrow();
  },
);

it("MEMBER 的资源、角色与普通读取权限遵循既有边界", () => {
  expectDenied(
    { ownsResource: false },
    "EXPENSE_UPDATE",
    "RESOURCE_NOT_OWNED",
    403,
  );
  expectDenied(
    { ownsResource: false },
    "SETTLEMENT_DELETE",
    "RESOURCE_NOT_OWNED",
    403,
  );
  expectDenied({}, "MEMBER_MANAGE", "ROLE_FORBIDDEN", 403);
  expectDenied({ role: "ADMIN" }, "OWNER_TRANSFER", "ROLE_FORBIDDEN", 403);
  expect(() => evaluateActivityOperation(context(), "READ")).not.toThrow();
});

it("生命周期操作只接受冻结的状态路径，并优先于 LEFT 与角色判断", () => {
  expect(() =>
    evaluateActivityOperation(context({ role: "ADMIN" }), "ACTIVITY_END"),
  ).not.toThrow();
  expect(() =>
    evaluateActivityOperation(context({ role: "ADMIN" }), "ACTIVITY_REOPEN"),
  ).toThrowError(
    expect.objectContaining({ code: "INVALID_ACTIVITY_TRANSITION" }),
  );
  expect(() =>
    evaluateActivityOperation(
      context({ lifecycle: "ENDED", role: "OWNER" }),
      "ACTIVITY_ARCHIVE",
    ),
  ).not.toThrow();
  expectDenied(
    { lifecycle: "ARCHIVED", memberStatus: "LEFT", role: "OWNER" },
    "ACTIVITY_ARCHIVE",
    "INVALID_ACTIVITY_TRANSITION",
    409,
  );
  expectDenied(
    { memberStatus: "LEFT", role: "OWNER" },
    "ACTIVITY_END",
    "LEFT_MEMBER_READ_ONLY",
    403,
  );
  expectDenied({}, "ACTIVITY_DELETE", "ROLE_FORBIDDEN", 403);
  expect(() =>
    evaluateActivityOperation(
      context({ lifecycle: "DELETED", role: "OWNER" }),
      "ACTIVITY_RESTORE",
    ),
  ).not.toThrow();
});

it("授权器查询活动与当前成员后返回已授权的类型事实", async () => {
  const activity = {
    id: "activity-1",
    status: "ACTIVE",
    deletedAt: null,
    baseCurrency: "CNY",
    revision: 3n,
  };
  const member = { id: "member-1", role: "MEMBER", status: "ACTIVE" };
  const tx = vi
    .fn()
    .mockResolvedValueOnce([activity])
    .mockResolvedValueOnce([member]);

  await expect(
    authorizeActivityOperation(tx as never, {
      session: { user: { id: "user-1" } },
      activityId: "activity-1",
      operation: "SETTLEMENT_CREATE",
      settlementPayerMemberId: "member-1",
    }),
  ).resolves.toEqual({ userId: "user-1", activity, member });
  expect(tx).toHaveBeenCalledTimes(2);
});

it("授权器在没有 session 时先拒绝且不查询数据库", async () => {
  const tx = vi.fn();

  await expect(
    authorizeActivityOperation(tx as never, {
      session: null,
      activityId: "activity-1",
      operation: "READ",
    }),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
  expect(tx).not.toHaveBeenCalled();
});
