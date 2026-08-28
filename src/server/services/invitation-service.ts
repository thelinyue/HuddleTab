import { createHash, randomBytes, randomUUID } from "node:crypto";

import type postgres from "postgres";

import type { InvitationRegistrationVerifier } from "@/server/auth/registration-gate";
import { ApplicationError } from "@/server/errors/application-error";
import {
  authorizeActivityOperation,
  type ActivityAuthorizationInput,
} from "@/server/permissions/authorize-activity-operation";
import { NotificationService } from "@/server/services/notification-service";

const tokenHash = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("base64url");

type ActivitySession = Pick<ActivityAuthorizationInput, "session">;

export type InvitationJoinResult =
  | {
      readonly status: "JOINED" | "ALREADY_MEMBER";
      readonly activityId: string;
      readonly memberId: string;
    }
  | {
      readonly status: "PENDING_APPROVAL";
      readonly activityId: string;
      readonly requestId: string;
    };

/**
 * 邀请链接的明文只在生成时返回给调用者。数据库和审计永远只保存不可逆摘要，
 * 加入、审批与成员创建均在一个受权限保护的事务内完成。V1 不按创建时间自动
 * 过期，created_at 仅用于审计；有效性只由当前 Token、启用状态和活动生命周期决定。
 */
export class InvitationService implements InvitationRegistrationVerifier {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  async resetLink(
    input: ActivitySession & { readonly activityId: string },
  ): Promise<string> {
    const raw = randomBytes(32).toString("base64url");
    await this.sql.begin(async (transaction) => {
      const actor = await authorizeActivityOperation(transaction, {
        session: input.session,
        activityId: input.activityId,
        operation: "MEMBER_MANAGE",
      });
      await transaction`update activity_invite_tokens set enabled = false where activity_id = ${input.activityId}`;
      await transaction`insert into activity_invite_tokens (id, activity_id, token_hash, enabled, created_by_member_id)
        values (${randomUUID()}, ${input.activityId}, ${tokenHash(raw)}, true, ${actor.member.id})`;
      await this.auditAndRevise(
        transaction,
        input.activityId,
        actor.member.id,
        actor.userId,
        "INVITATION_LINK_RESET",
        input.activityId,
      );
    });
    return raw;
  }

  async disableLink(
    input: ActivitySession & { readonly activityId: string },
  ): Promise<void> {
    await this.sql.begin(async (transaction) => {
      const actor = await authorizeActivityOperation(transaction, {
        session: input.session,
        activityId: input.activityId,
        operation: "MEMBER_MANAGE",
      });
      await transaction`update activity_invite_tokens set enabled = false where activity_id = ${input.activityId}`;
      await this.auditAndRevise(
        transaction,
        input.activityId,
        actor.member.id,
        actor.userId,
        "INVITATION_LINK_DISABLED",
        input.activityId,
      );
    });
  }

  async verify(proof: string): Promise<boolean> {
    const rows = await this
      .sql`select 1 from activity_invite_tokens token join activities activity on activity.id = token.activity_id
        where token.token_hash = ${tokenHash(proof)} and token.enabled = true and activity.deleted_at is null and activity.status = 'ACTIVE'
        limit 1`;
    return rows.length === 1;
  }

  async join(
    input: ActivitySession & {
      readonly inviteProof: string;
      readonly activityId?: string;
      readonly displayName?: string;
    },
  ): Promise<InvitationJoinResult> {
    if (!input.session) {
      throw new ApplicationError(
        "UNAUTHENTICATED",
        "登录状态已失效，请重新登录。",
        401,
      );
    }
    const joiningUserId = input.session.user.id;
    return this.sql.begin(async (transaction) => {
      const notifications = new NotificationService(this.sql);
      const [activity] =
        await transaction`select activity.id, activity.invite_mode from activities activity
          join activity_invite_tokens token on token.activity_id = activity.id
          where token.token_hash = ${tokenHash(input.inviteProof)}
            and token.enabled = true and activity.status = 'ACTIVE' and activity.deleted_at is null
          for update of activity`;
      if (!activity || (input.activityId && activity.id !== input.activityId)) {
        throw new ApplicationError(
          "INVALID_INVITATION",
          "邀请链接无效或已失效。",
          403,
        );
      }
      const existing =
        await transaction`select id from activity_members where activity_id = ${activity.id} and user_id = ${joiningUserId} limit 1`;
      if (existing.length > 0) {
        return {
          status: "ALREADY_MEMBER",
          activityId: activity.id,
          memberId: existing[0].id,
        };
      }
      const [identity] =
        await transaction`select coalesce(profile.nickname, account.name) as display_name
          from "user" account
          left join user_profiles profile on profile.user_id = account.id
          where account.id = ${joiningUserId} limit 1`;
      const displayName = input.displayName?.trim() || identity?.display_name;
      if (!displayName) {
        throw new ApplicationError(
          "PROFILE_NOT_FOUND",
          "账号资料不存在，请重新登录后重试。",
          404,
        );
      }
      const id = randomUUID();
      if (activity.invite_mode === "REQUIRE_APPROVAL") {
        const pending =
          await transaction`select id from activity_join_requests where activity_id = ${activity.id} and user_id = ${joiningUserId} and status = 'PENDING' limit 1`;
        if (pending.length > 0) {
          return {
            status: "PENDING_APPROVAL",
            activityId: activity.id,
            requestId: pending[0].id,
          };
        }
        await transaction`insert into activity_join_requests (id, activity_id, user_id, status)
          values (${id}, ${activity.id}, ${joiningUserId}, 'PENDING')`;
        const reviewers =
          await transaction`select user_id from activity_members where activity_id = ${activity.id}
            and role in ('OWNER', 'ADMIN') and status = 'ACTIVE' and user_id is not null`;
        for (const reviewer of reviewers) {
          await notifications.create(transaction, {
            recipientUserId: reviewer.user_id,
            type: "JOIN_APPROVAL_REQUESTED",
            targetType: "ACTIVITY",
            targetId: activity.id,
            payload: { requestId: id, displayName },
          });
        }
        await this.auditAndRevise(
          transaction,
          activity.id,
          null,
          joiningUserId,
          "JOIN_REQUEST_CREATED",
          id,
        );
        return {
          status: "PENDING_APPROVAL",
          activityId: activity.id,
          requestId: id,
        };
      }
      await transaction`insert into activity_members (id, activity_id, user_id, display_name, member_type, role, status, joined_at)
        values (${id}, ${activity.id}, ${joiningUserId}, ${displayName}, 'USER', 'MEMBER', 'ACTIVE', now())`;
      const reviewers =
        await transaction`select user_id from activity_members where activity_id = ${activity.id}
          and role in ('OWNER', 'ADMIN') and status = 'ACTIVE' and user_id is not null and user_id <> ${joiningUserId}`;
      for (const reviewer of reviewers) {
        await notifications.create(transaction, {
          recipientUserId: reviewer.user_id,
          type: "MEMBER_JOINED",
          targetType: "ACTIVITY",
          targetId: activity.id,
          payload: { memberId: id, displayName },
        });
      }
      await this.auditAndRevise(
        transaction,
        activity.id,
        null,
        joiningUserId,
        "MEMBER_JOINED",
        id,
      );
      return { status: "JOINED", activityId: activity.id, memberId: id };
    });
  }

  async decideJoinRequest(
    input: ActivitySession & {
      readonly activityId: string;
      readonly requestId: string;
      readonly decision: "APPROVE" | "REJECT";
    },
  ): Promise<void> {
    await this.sql.begin(async (transaction) => {
      const notifications = new NotificationService(this.sql);
      const [request] =
        await transaction`select request.id, request.activity_id, request.user_id, request.status,
            coalesce(profile.nickname, account.name) as display_name
          from activity_join_requests request
          join "user" account on account.id = request.user_id
          left join user_profiles profile on profile.user_id = request.user_id
          where request.id = ${input.requestId} for update of request`;
      if (!request || request.status !== "PENDING") {
        throw new ApplicationError(
          "JOIN_REQUEST_CLOSED",
          "加入申请不存在或已经处理。",
          409,
        );
      }
      if (request.activity_id !== input.activityId) {
        throw new ApplicationError(
          "ACTIVITY_NOT_FOUND",
          "活动不存在或你无权查看。",
          404,
        );
      }
      const actor = await authorizeActivityOperation(transaction, {
        session: input.session,
        activityId: request.activity_id,
        operation: "MEMBER_MANAGE",
      });
      if (input.decision === "APPROVE") {
        await transaction`insert into activity_members (id, activity_id, user_id, display_name, member_type, role, status, joined_at)
          values (${randomUUID()}, ${request.activity_id}, ${request.user_id}, ${request.display_name}, 'USER', 'MEMBER', 'ACTIVE', now())`;
      }
      const status = input.decision === "APPROVE" ? "APPROVED" : "REJECTED";
      await transaction`update activity_join_requests set status = ${status}, decided_by_member_id = ${actor.member.id}, decided_at = now() where id = ${input.requestId}`;
      await notifications.create(transaction, {
        recipientUserId: request.user_id,
        type: "JOIN_APPROVAL_RESOLVED",
        targetType: "ACTIVITY",
        targetId: request.activity_id,
        payload: { decision: input.decision },
      });
      await this.auditAndRevise(
        transaction,
        request.activity_id,
        actor.member.id,
        actor.userId,
        `JOIN_REQUEST_${status}`,
        request.id,
      );
    });
  }

  private async auditAndRevise(
    transaction: postgres.TransactionSql,
    activityId: string,
    actorMemberId: string | null,
    actorUserId: string,
    eventType: string,
    targetId: string,
  ): Promise<void> {
    await transaction`insert into activity_audit_logs (id, activity_id, actor_user_id, actor_member_id, event_type, target_type, target_id, metadata)
      values (${randomUUID()}, ${activityId}, ${actorUserId}, ${actorMemberId}, ${eventType}, 'INVITATION', ${targetId}, '{}'::jsonb)`;
    await transaction`update activities set revision = revision + 1, updated_at = now() where id = ${activityId}`;
  }
}
