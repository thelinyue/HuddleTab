import type postgres from "postgres";

import { ApplicationError } from "@/server/errors/application-error";

export type ActivityOperation =
  | "READ"
  | "LEDGER_READ"
  | "EXPENSE_CREATE"
  | "EXPENSE_UPDATE"
  | "EXPENSE_DELETE"
  | "SETTLEMENT_CREATE"
  | "SETTLEMENT_UPDATE"
  | "SETTLEMENT_DELETE"
  | "ATTACHMENT_READ"
  | "ATTACHMENT_WRITE"
  | "MEMBER_MANAGE"
  | "OWNER_TRANSFER"
  | "ACTIVITY_LIFECYCLE";

export interface ActivityPermissionContext {
  readonly hasSession: boolean;
  readonly membershipExists: boolean;
  readonly lifecycle: "ACTIVE" | "ENDED" | "ARCHIVED" | "DELETED";
  readonly memberStatus: "ACTIVE" | "LEFT";
  readonly role: "OWNER" | "ADMIN" | "MEMBER";
  readonly ownsResource: boolean;
  readonly payerIsSelf?: boolean;
  readonly createdBySelf?: boolean;
}

const readOperations: readonly ActivityOperation[] = [
  "READ",
  "LEDGER_READ",
  "ATTACHMENT_READ",
];
const settlementOperations: readonly ActivityOperation[] = [
  "SETTLEMENT_CREATE",
  "SETTLEMENT_UPDATE",
  "SETTLEMENT_DELETE",
];
const resourceWriteOperations: readonly ActivityOperation[] = [
  "EXPENSE_UPDATE",
  "EXPENSE_DELETE",
  "SETTLEMENT_UPDATE",
  "SETTLEMENT_DELETE",
];
const lifecycleOperations: readonly ActivityOperation[] = [
  "ACTIVITY_LIFECYCLE",
];

/**
 * 固定顺序是安全边界：调用者只能提供事实，不能跳过活动生命周期或 LEFT 状态
 * 直接按角色授权。后续所有活动写入都必须经由此函数。
 */
export function evaluateActivityOperation(
  context: ActivityPermissionContext,
  operation: ActivityOperation,
): void {
  if (!context.hasSession) {
    throw new ApplicationError(
      "UNAUTHENTICATED",
      "登录状态已失效，请重新登录。",
      401,
    );
  }
  if (!context.membershipExists) {
    throw new ApplicationError(
      "ACTIVITY_NOT_FOUND",
      "活动不存在或你无权查看。",
      404,
    );
  }
  if (
    (context.lifecycle === "DELETED" &&
      !lifecycleOperations.includes(operation)) ||
    (context.lifecycle === "ARCHIVED" &&
      !readOperations.includes(operation) &&
      !lifecycleOperations.includes(operation))
  ) {
    throw new ApplicationError(
      "ACTIVITY_READ_ONLY",
      "当前活动状态不允许此操作。",
      409,
    );
  }
  if (
    context.lifecycle === "ENDED" &&
    !readOperations.includes(operation) &&
    !settlementOperations.includes(operation) &&
    !lifecycleOperations.includes(operation)
  ) {
    throw new ApplicationError(
      "ACTIVITY_READ_ONLY",
      "活动已结束，仅可继续处理实际结算。",
      409,
    );
  }
  if (
    context.memberStatus === "LEFT" &&
    !readOperations.includes(operation) &&
    !settlementOperations.includes(operation)
  ) {
    throw new ApplicationError(
      operation.startsWith("EXPENSE_")
        ? "EXPENSE_READ_ONLY_FOR_LEFT"
        : "LEFT_MEMBER_READ_ONLY",
      "你已退出活动，历史消费仅可查看。",
      403,
    );
  }
  if (operation === "MEMBER_MANAGE" && context.role === "MEMBER") {
    throw new ApplicationError("ROLE_FORBIDDEN", "当前角色不能管理成员。", 403);
  }
  if (operation === "OWNER_TRANSFER" && context.role !== "OWNER") {
    throw new ApplicationError(
      "ROLE_FORBIDDEN",
      "只有活动 Owner 可以转让所有权。",
      403,
    );
  }
  if (
    resourceWriteOperations.includes(operation) &&
    context.role === "MEMBER" &&
    !context.ownsResource
  ) {
    throw new ApplicationError(
      "RESOURCE_NOT_OWNED",
      "你只能修改自己创建的记录。",
      403,
    );
  }
  if (
    settlementOperations.includes(operation) &&
    (context.memberStatus === "LEFT" || context.role === "MEMBER") &&
    !context.payerIsSelf
  ) {
    throw new ApplicationError(
      "SETTLEMENT_PAYER_MUST_BE_SELF",
      "你只能记录付款人为自己的结算。",
      403,
    );
  }
  if (
    ["SETTLEMENT_UPDATE", "SETTLEMENT_DELETE"].includes(operation) &&
    context.memberStatus === "LEFT" &&
    !context.createdBySelf
  ) {
    throw new ApplicationError(
      "RESOURCE_NOT_OWNED",
      "你不能修改其他成员创建的结算。",
      403,
    );
  }
}

export interface ActivityAuthorizationInput {
  readonly session: { readonly user: { readonly id: string } } | null;
  readonly activityId: string;
  readonly operation: ActivityOperation;
  readonly resourceOwnerMemberId?: string;
  readonly settlementPayerMemberId?: string;
}

export interface ActivityAuthorization {
  readonly userId: string;
  readonly activity: {
    readonly id: string;
    readonly status: "ACTIVE" | "ENDED" | "ARCHIVED";
    readonly deletedAt: Date | null;
    readonly baseCurrency: string;
    readonly revision: bigint;
  };
  readonly member: {
    readonly id: string;
    readonly role: "OWNER" | "ADMIN" | "MEMBER";
    readonly status: "ACTIVE" | "LEFT";
  };
}

/** 查询事实后统一进入固定 evaluator，Route 和 Service 不得自行跳过任一判断层。 */
export async function authorizeActivityOperation(
  transaction: postgres.TransactionSql,
  input: ActivityAuthorizationInput,
): Promise<ActivityAuthorization> {
  if (!input.session) {
    evaluateActivityOperation(
      { hasSession: false } as ActivityPermissionContext,
      input.operation,
    );
  }

  const [activity] =
    await transaction`select id, status, deleted_at, base_currency, revision from activities where id = ${input.activityId}`;
  const [member] =
    await transaction`select id, role, status from activity_members where activity_id = ${input.activityId} and user_id = ${input.session!.user.id}`;
  const lifecycle = !activity
    ? "DELETED"
    : activity.deleted_at
      ? "DELETED"
      : activity.status;

  evaluateActivityOperation(
    {
      hasSession: true,
      membershipExists: Boolean(activity && member),
      lifecycle,
      memberStatus: member?.status ?? "LEFT",
      role: member?.role ?? "MEMBER",
      ownsResource:
        !input.resourceOwnerMemberId ||
        input.resourceOwnerMemberId === member?.id,
      payerIsSelf:
        !input.settlementPayerMemberId ||
        input.settlementPayerMemberId === member?.id,
      createdBySelf:
        !input.resourceOwnerMemberId ||
        input.resourceOwnerMemberId === member?.id,
    },
    input.operation,
  );

  return {
    userId: input.session!.user.id,
    activity: {
      id: activity!.id,
      status: activity!.status,
      deletedAt: activity!.deleted_at,
      baseCurrency: activity!.base_currency,
      revision: activity!.revision,
    },
    member: {
      id: member!.id,
      role: member!.role,
      status: member!.status,
    },
  };
}
