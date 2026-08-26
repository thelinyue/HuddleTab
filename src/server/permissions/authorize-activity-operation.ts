import type { TransactionSql } from "postgres";
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
  | "OWNER_TRANSFER";

type ActivityLifecycle = "ACTIVE" | "ENDED" | "ARCHIVED" | "DELETED";
type ActivityRole = "OWNER" | "ADMIN" | "MEMBER";
type MemberStatus = "ACTIVE" | "LEFT";

/**
 * 权限判定只接收已加载的事实，并严格按 session、成员、活动、成员状态、角色、资源和操作的
 * 固定顺序执行；路由和服务不得绕过或重排此安全边界。
 */
export interface ActivityPermissionContext {
  hasSession: boolean;
  membershipExists: boolean;
  lifecycle: ActivityLifecycle;
  memberStatus: MemberStatus;
  role: ActivityRole;
  ownsResource: boolean;
  payerIsSelf?: boolean;
  createdBySelf?: boolean;
}

/** 调用方仅传入身份、操作和资源归属事实，授权器会在事务内完成固定顺序判定。 */
export interface ActivityAuthorizationInput {
  session: { user: { id: string } } | null;
  activityId: string;
  operation: ActivityOperation;
  resourceOwnerMemberId?: string;
  settlementPayerMemberId?: string;
}

/**
 * 授权成功后返回同一事务内读取到的活动和成员事实，调用方不得重新查询后跳过固定判定顺序。
 */
export interface ActivityAuthorization {
  userId: string;
  activity: {
    id: string;
    status: "ACTIVE" | "ENDED" | "ARCHIVED";
    deletedAt: Date | null;
    baseCurrency: string;
    revision: bigint;
  };
  member: { id: string; role: ActivityRole; status: MemberStatus };
}

const settlementOperations = new Set<ActivityOperation>([
  "SETTLEMENT_CREATE",
  "SETTLEMENT_UPDATE",
  "SETTLEMENT_DELETE",
]);
const resourceOperations = new Set<ActivityOperation>([
  "EXPENSE_UPDATE",
  "EXPENSE_DELETE",
  "SETTLEMENT_UPDATE",
  "SETTLEMENT_DELETE",
]);
const readOperations = new Set<ActivityOperation>([
  "READ",
  "LEDGER_READ",
  "ATTACHMENT_READ",
]);

function isWrite(operation: ActivityOperation): boolean {
  return !readOperations.has(operation);
}

function isLeftAllowedOperation(operation: ActivityOperation): boolean {
  return readOperations.has(operation) || settlementOperations.has(operation);
}

/**
 * 单一权限求值器以固定顺序拒绝请求，避免调用方先执行角色或资源判断而泄露活动状态与成员信息。
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
      "活动不存在，或您不是该活动成员。",
      404,
    );
  }

  if (
    context.lifecycle === "DELETED" ||
    (context.lifecycle === "ARCHIVED" && isWrite(operation)) ||
    (context.lifecycle === "ENDED" &&
      isWrite(operation) &&
      !settlementOperations.has(operation))
  ) {
    throw new ApplicationError(
      "ACTIVITY_READ_ONLY",
      "活动当前为只读状态，不能执行此操作。",
      409,
    );
  }

  if (context.memberStatus === "LEFT" && !isLeftAllowedOperation(operation)) {
    throw new ApplicationError(
      "LEFT_MEMBER_READ_ONLY",
      "您已离开活动，不能执行此操作。",
      403,
    );
  }

  if (
    (operation === "MEMBER_MANAGE" && context.role === "MEMBER") ||
    (operation === "OWNER_TRANSFER" && context.role !== "OWNER")
  ) {
    throw new ApplicationError(
      "ROLE_FORBIDDEN",
      "当前成员角色无权执行此操作。",
      403,
    );
  }

  if (
    context.role === "MEMBER" &&
    resourceOperations.has(operation) &&
    !context.ownsResource
  ) {
    throw new ApplicationError(
      "RESOURCE_NOT_OWNED",
      "只能操作自己创建的资源。",
      403,
    );
  }

  if (
    settlementOperations.has(operation) &&
    (context.memberStatus === "LEFT" || context.role === "MEMBER") &&
    !context.payerIsSelf
  ) {
    throw new ApplicationError(
      "SETTLEMENT_PAYER_MUST_BE_SELF",
      "普通成员或已离开活动的成员只能处理由自己付款的结算。",
      403,
    );
  }

  if (
    context.memberStatus === "LEFT" &&
    (operation === "SETTLEMENT_UPDATE" || operation === "SETTLEMENT_DELETE") &&
    !context.createdBySelf
  ) {
    throw new ApplicationError(
      "RESOURCE_NOT_OWNED",
      "只能操作自己创建的资源。",
      403,
    );
  }
}

/**
 * 在同一事务内加载活动和当前成员，再交给唯一求值器按固定顺序授权，禁止业务入口自行拼接判断。
 */
export async function authorizeActivityOperation(
  tx: TransactionSql,
  input: ActivityAuthorizationInput,
): Promise<ActivityAuthorization> {
  if (!input.session) {
    evaluateActivityOperation(
      {
        hasSession: false,
        membershipExists: false,
        lifecycle: "DELETED",
        memberStatus: "LEFT",
        role: "MEMBER",
        ownsResource: false,
      },
      input.operation,
    );
  }

  const userId = input.session!.user.id;
  const [activity] = await tx<ActivityAuthorization["activity"][]>`
    select
      id,
      status,
      deleted_at as "deletedAt",
      base_currency as "baseCurrency",
      revision
    from activities
    where id = ${input.activityId}
  `;
  const [member] = await tx<ActivityAuthorization["member"][]>`
    select id, role, status
    from activity_members
    where activity_id = ${input.activityId} and user_id = ${userId}
  `;

  const lifecycle: ActivityLifecycle =
    !activity || activity.deletedAt ? "DELETED" : activity.status;
  const ownsResource = input.resourceOwnerMemberId === member?.id;

  evaluateActivityOperation(
    {
      hasSession: true,
      membershipExists: Boolean(activity && member),
      lifecycle,
      memberStatus: member?.status ?? "LEFT",
      role: member?.role ?? "MEMBER",
      ownsResource,
      payerIsSelf: input.settlementPayerMemberId === member?.id,
      createdBySelf: ownsResource,
    },
    input.operation,
  );

  return { userId, activity: activity!, member: member! };
}
