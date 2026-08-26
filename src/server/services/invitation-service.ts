import { createHash, randomBytes, randomUUID } from "node:crypto";

import type postgres from "postgres";

import type { InvitationRegistrationVerifier } from "@/server/auth/registration-gate";
import { ApplicationError } from "@/server/errors/application-error";
import {
  authorizeActivityOperation,
  type ActivityAuthorizationInput,
} from "@/server/permissions/authorize-activity-operation";

const tokenHash = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("base64url");

type ActivitySession = Pick<ActivityAuthorizationInput, "session">;

/**
 * 邀请链接的明文只在生成时返回给调用者。数据库和审计永远只保存不可逆摘要，
 * 加入、审批与成员创建均在一个受权限保护的事务内完成。
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
      readonly activityId: string;
      readonly inviteProof: string;
      readonly displayName: string;
    },
  ): Promise<{ memberId?: string; requestId?: string }> {
    if (!input.session) {
      throw new ApplicationError(
        "UNAUTHENTICATED",
        "登录状态已失效，请重新登录。",
        401,
      );
    }
    const joiningUserId = input.session.user.id;
    return this.sql.begin(async (transaction) => {
      const [activity] =
        await transaction`select activity.id, activity.invite_mode from activities activity
          join activity_invite_tokens token on token.activity_id = activity.id
          where activity.id = ${input.activityId} and token.token_hash = ${tokenHash(input.inviteProof)}
            and token.enabled = true and activity.status = 'ACTIVE' and activity.deleted_at is null
          for update of activity`;
      if (!activity) {
        throw new ApplicationError(
          "INVALID_INVITATION",
          "邀请链接无效或已失效。",
          403,
        );
      }
      const existing =
        await transaction`select id from activity_members where activity_id = ${input.activityId} and user_id = ${joiningUserId} limit 1`;
      if (existing.length > 0) {
        throw new ApplicationError(
          "ALREADY_ACTIVITY_MEMBER",
          "你已经是该活动成员。",
          409,
        );
      }
      const id = randomUUID();
      if (activity.invite_mode === "REQUIRE_APPROVAL") {
        const pending =
          await transaction`select id from activity_join_requests where activity_id = ${input.activityId} and user_id = ${joiningUserId} and status = 'PENDING' limit 1`;
        if (pending.length > 0) {
          throw new ApplicationError(
            "JOIN_REQUEST_PENDING",
            "加入申请正在等待审批。",
            409,
          );
        }
        await transaction`insert into activity_join_requests (id, activity_id, user_id, status)
          values (${id}, ${input.activityId}, ${joiningUserId}, 'PENDING')`;
        await this.auditAndRevise(
          transaction,
          input.activityId,
          null,
          joiningUserId,
          "JOIN_REQUEST_CREATED",
          id,
        );
        return { requestId: id };
      }
      await transaction`insert into activity_members (id, activity_id, user_id, display_name, member_type, role, status, joined_at)
        values (${id}, ${input.activityId}, ${joiningUserId}, ${input.displayName}, 'USER', 'MEMBER', 'ACTIVE', now())`;
      await this.auditAndRevise(
        transaction,
        input.activityId,
        null,
        joiningUserId,
        "MEMBER_JOINED",
        id,
      );
      return { memberId: id };
    });
  }

  async decideJoinRequest(
    input: ActivitySession & {
      readonly activityId: string;
      readonly requestId: string;
      readonly decision: "APPROVE" | "REJECT";
      readonly displayName: string;
    },
  ): Promise<void> {
    await this.sql.begin(async (transaction) => {
      const [request] =
        await transaction`select id, activity_id, user_id, status from activity_join_requests where id = ${input.requestId} for update`;
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
          values (${randomUUID()}, ${request.activity_id}, ${request.user_id}, ${input.displayName}, 'USER', 'MEMBER', 'ACTIVE', now())`;
      }
      const status = input.decision === "APPROVE" ? "APPROVED" : "REJECTED";
      await transaction`update activity_join_requests set status = ${status}, decided_by_member_id = ${actor.member.id}, decided_at = now() where id = ${input.requestId}`;
      await transaction`insert into notifications (id, recipient_user_id, type, target_type, target_id, payload)
        values (${randomUUID()}, ${request.user_id}, ${`JOIN_REQUEST_${status}`}, 'ACTIVITY', ${request.activity_id}, ${JSON.stringify({ activityId: request.activity_id })}::jsonb)`;
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
