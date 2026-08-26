import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";

import { ApplicationError } from "@/server/errors/application-error";

type LockedActivity = {
  id: string;
  status: "ACTIVE" | "ENDED" | "ARCHIVED";
  deletedAt: Date | null;
  inviteMode: "DIRECT_JOIN" | "REQUIRE_APPROVAL";
};

type LockedManager = {
  id: string;
  userId: string | null;
  role: "OWNER" | "ADMIN" | "MEMBER";
  status: "ACTIVE" | "LEFT";
};

type LockedJoinRequest = {
  id: string;
  activityId: string;
  userId: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
};

export type JoinRequestDecision = "APPROVE" | "REJECT";

/**
 * 邀请链接、审批加入和其审计事实均在这个服务的事务内落库。原始链接令牌仅从 resetLink
 * 返回，并立即转换为 SHA-256 base64url 哈希；服务从不保存、记录或写入该原始值。
 */
export class InvitationService {
  constructor(private readonly sql: Sql | TransactionSql) {}

  async resetLink(activityId: string, actorMemberId: string): Promise<string> {
    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = this.hashToken(rawToken);

    await this.withTransaction(async (transaction) => {
      const manager = await this.lockActiveManager(
        transaction,
        activityId,
        actorMemberId,
      );
      await transaction`
        update activity_invite_tokens
        set enabled = false
        where activity_id = ${activityId} and enabled = true
      `;
      await transaction`
        insert into activity_invite_tokens (
          id, activity_id, token_hash, enabled, created_by_member_id
        ) values (
          ${randomUUID()}, ${activityId}, ${tokenHash}, true, ${actorMemberId}
        )
      `;
      await this.writeActivityAudit(
        transaction,
        activityId,
        "INVITE_LINK_RESET",
        "ACTIVITY",
        activityId,
        actorMemberId,
        manager.userId ?? undefined,
      );
      await this.incrementRevision(transaction, activityId);
    });

    return rawToken;
  }

  async disableLink(activityId: string, actorMemberId: string): Promise<void> {
    await this.withTransaction(async (transaction) => {
      const manager = await this.lockActiveManager(
        transaction,
        activityId,
        actorMemberId,
      );
      const disabled = await transaction<{ id: string }[]>`
        update activity_invite_tokens
        set enabled = false
        where activity_id = ${activityId} and enabled = true
        returning id
      `;
      if (disabled.length === 0) return;

      await this.writeActivityAudit(
        transaction,
        activityId,
        "INVITE_LINK_DISABLED",
        "ACTIVITY",
        activityId,
        actorMemberId,
        manager.userId ?? undefined,
      );
      await this.incrementRevision(transaction, activityId);
    });
  }

  async verify(raw: string): Promise<boolean> {
    const tokenHash = this.hashToken(raw);
    const tokens = await this.sql`
      select token.id
      from activity_invite_tokens token
      join activities activity on activity.id = token.activity_id
      where token.token_hash = ${tokenHash}
        and token.enabled = true
        and activity.status = 'ACTIVE'
        and activity.deleted_at is null
      limit 1
    `;
    return tokens.length === 1;
  }

  async join(
    activityId: string,
    userId: string,
    displayName: string,
  ): Promise<{ memberId?: string; requestId?: string }> {
    try {
      return await this.withTransaction(async (transaction) => {
        const activity = await this.lockActivity(transaction, activityId);
        this.assertActiveActivity(activity);

        const existingMembers = await transaction`
          select id from activity_members
          where activity_id = ${activityId} and user_id = ${userId}
          limit 1
          for update
        `;
        if (existingMembers.length !== 0) {
          throw new ApplicationError(
            "ALREADY_ACTIVITY_MEMBER",
            "您已经是该活动成员。",
            409,
          );
        }

        if (activity.inviteMode === "DIRECT_JOIN") {
          const memberId = randomUUID();
          await transaction`
            insert into activity_members (
              id, activity_id, user_id, display_name, member_type, role, status
            ) values (
              ${memberId}, ${activityId}, ${userId}, ${displayName}, 'USER', 'MEMBER', 'ACTIVE'
            )
          `;
          await this.writeActivityAudit(
            transaction,
            activityId,
            "MEMBER_JOINED",
            "ACTIVITY_MEMBER",
            memberId,
            memberId,
            userId,
          );
          await this.incrementRevision(transaction, activityId);
          return { memberId };
        }

        const existingRequests = await transaction`
          select id from activity_join_requests
          where activity_id = ${activityId}
            and user_id = ${userId}
            and status = 'PENDING'
          limit 1
          for update
        `;
        if (existingRequests.length !== 0) {
          throw new ApplicationError(
            "JOIN_REQUEST_PENDING",
            "您已有待处理的加入申请。",
            409,
          );
        }

        const requestId = randomUUID();
        await transaction`
          insert into activity_join_requests (id, activity_id, user_id, status)
          values (${requestId}, ${activityId}, ${userId}, 'PENDING')
        `;
        await this.writeActivityAudit(
          transaction,
          activityId,
          "JOIN_REQUEST_CREATED",
          "ACTIVITY_JOIN_REQUEST",
          requestId,
          undefined,
          userId,
        );
        await this.incrementRevision(transaction, activityId);
        return { requestId };
      });
    } catch (error) {
      if (this.hasConstraint(error, "activity_members_activity_user_uq")) {
        throw new ApplicationError(
          "ALREADY_ACTIVITY_MEMBER",
          "您已经是该活动成员。",
          409,
        );
      }
      if (this.hasConstraint(error, "activity_join_requests_pending_uq")) {
        throw new ApplicationError(
          "JOIN_REQUEST_PENDING",
          "您已有待处理的加入申请。",
          409,
        );
      }
      throw error;
    }
  }

  async decideJoinRequest(
    requestId: string,
    actorMemberId: string,
    decision: JoinRequestDecision,
    displayName: string,
  ): Promise<void> {
    try {
      await this.withTransaction(async (transaction) => {
        const request = await this.lockJoinRequest(transaction, requestId);
        const activity = await this.lockActivity(
          transaction,
          request.activityId,
        );
        if (request.status !== "PENDING") {
          throw new ApplicationError(
            "JOIN_REQUEST_ALREADY_DECIDED",
            "该加入申请已经处理。",
            409,
          );
        }
        this.assertActiveActivity(activity);
        const manager = await this.lockManager(
          transaction,
          activity.id,
          actorMemberId,
        );
        this.assertManager(manager);

        if (decision === "APPROVE") {
          const members = await transaction`
            select id from activity_members
            where activity_id = ${activity.id} and user_id = ${request.userId}
            limit 1
            for update
          `;
          if (members.length !== 0) {
            throw new ApplicationError(
              "ALREADY_ACTIVITY_MEMBER",
              "该用户已经是活动成员。",
              409,
            );
          }
          await transaction`
            insert into activity_members (
              id, activity_id, user_id, display_name, member_type, role, status
            ) values (
              ${randomUUID()}, ${activity.id}, ${request.userId}, ${displayName}, 'USER', 'MEMBER', 'ACTIVE'
            )
          `;
        }

        const status = decision === "APPROVE" ? "APPROVED" : "REJECTED";
        const eventType =
          decision === "APPROVE"
            ? "JOIN_REQUEST_APPROVED"
            : "JOIN_REQUEST_REJECTED";
        await transaction`
          update activity_join_requests
          set
            status = ${status},
            decided_by_member_id = ${actorMemberId},
            decided_at = now()
          where id = ${requestId}
        `;
        await this.writeActivityAudit(
          transaction,
          activity.id,
          eventType,
          "ACTIVITY_JOIN_REQUEST",
          requestId,
          actorMemberId,
          manager.userId ?? undefined,
        );
        await transaction`
          insert into notifications (
            id, recipient_user_id, type, target_type, target_id, payload
          ) values (
            ${randomUUID()}, ${request.userId}, ${eventType}, 'ACTIVITY', ${activity.id}, '{}'::jsonb
          )
        `;
        await this.incrementRevision(transaction, activity.id);
      });
    } catch (error) {
      if (this.hasConstraint(error, "activity_members_activity_user_uq")) {
        throw new ApplicationError(
          "ALREADY_ACTIVITY_MEMBER",
          "该用户已经是活动成员。",
          409,
        );
      }
      throw error;
    }
  }

  private hashToken(raw: string): string {
    return createHash("sha256").update(raw).digest("base64url");
  }

  /** 路由已持有事务时直接复用它；独立服务调用则创建新的数据库事务。 */
  private async withTransaction<T>(
    callback: (transaction: TransactionSql) => Promise<T>,
  ): Promise<T> {
    if ("begin" in this.sql) {
      // postgres.js 会为数组结果展开 begin 的泛型；这里的回调返回值由本服务独占，保留 T。
      return this.sql.begin(callback) as Promise<T>;
    }
    return callback(this.sql);
  }

  /** 活动行先锁定，令牌/申请写入与 revision、审计始终处于同一事务边界。 */
  private async lockActivity(
    transaction: TransactionSql,
    activityId: string,
  ): Promise<LockedActivity> {
    const [activity] = await transaction<LockedActivity[]>`
      select
        id,
        status,
        deleted_at as "deletedAt",
        invite_mode as "inviteMode"
      from activities
      where id = ${activityId}
      for update
    `;
    if (!activity || activity.deletedAt) {
      throw new ApplicationError(
        "ACTIVITY_NOT_FOUND",
        "活动不存在或已删除。",
        404,
      );
    }
    return activity;
  }

  private async lockActiveManager(
    transaction: TransactionSql,
    activityId: string,
    actorMemberId: string,
  ): Promise<LockedManager> {
    const activity = await this.lockActivity(transaction, activityId);
    this.assertActiveActivity(activity);
    const manager = await this.lockManager(
      transaction,
      activityId,
      actorMemberId,
    );
    this.assertManager(manager);
    return manager;
  }

  private async lockManager(
    transaction: TransactionSql,
    activityId: string,
    actorMemberId: string,
  ): Promise<LockedManager> {
    const [manager] = await transaction<LockedManager[]>`
      select
        id,
        user_id as "userId",
        role,
        status
      from activity_members
      where id = ${actorMemberId} and activity_id = ${activityId}
      for update
    `;
    if (!manager) {
      throw new ApplicationError(
        "ROLE_FORBIDDEN",
        "当前成员无权管理活动邀请。",
        403,
      );
    }
    return manager;
  }

  private async lockJoinRequest(
    transaction: TransactionSql,
    requestId: string,
  ): Promise<LockedJoinRequest> {
    const [request] = await transaction<LockedJoinRequest[]>`
      select
        id,
        activity_id as "activityId",
        user_id as "userId",
        status
      from activity_join_requests
      where id = ${requestId}
      for update
    `;
    if (!request) {
      throw new ApplicationError(
        "JOIN_REQUEST_NOT_FOUND",
        "加入申请不存在。",
        404,
      );
    }
    return request;
  }

  private assertActiveActivity(activity: LockedActivity): void {
    if (activity.status !== "ACTIVE") {
      throw new ApplicationError(
        "ACTIVITY_READ_ONLY",
        "活动当前不是进行中状态，不能处理邀请。",
        409,
      );
    }
  }

  private assertManager(manager: LockedManager): void {
    if (
      manager.status !== "ACTIVE" ||
      (manager.role !== "OWNER" && manager.role !== "ADMIN")
    ) {
      throw new ApplicationError(
        "ROLE_FORBIDDEN",
        "当前成员无权管理活动邀请。",
        403,
      );
    }
  }

  private async incrementRevision(
    transaction: TransactionSql,
    activityId: string,
  ): Promise<void> {
    await transaction`
      update activities
      set revision = revision + 1, updated_at = now()
      where id = ${activityId}
    `;
  }

  private async writeActivityAudit(
    transaction: TransactionSql,
    activityId: string,
    eventType: string,
    targetType: string,
    targetId: string,
    actorMemberId?: string,
    actorUserId?: string,
  ): Promise<void> {
    await transaction`
      insert into activity_audit_logs (
        id, activity_id, actor_user_id, actor_member_id, event_type, target_type, target_id, metadata
      ) values (
        ${randomUUID()}, ${activityId}, ${actorUserId ?? null}, ${actorMemberId ?? null},
        ${eventType}, ${targetType}, ${targetId}, '{}'::jsonb
      )
    `;
  }

  private hasConstraint(error: unknown, constraint: string): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      "constraint_name" in error &&
      error.code === "23505" &&
      error.constraint_name === constraint
    );
  }
}
