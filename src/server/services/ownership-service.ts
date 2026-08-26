import { randomUUID } from "node:crypto";

import type postgres from "postgres";

import {
  authorizeActivityOperation,
  type ActivityAuthorizationInput,
} from "@/server/permissions/authorize-activity-operation";
import { ApplicationError } from "@/server/errors/application-error";

export interface TransferOwnershipInput {
  readonly session: ActivityAuthorizationInput["session"];
  readonly activityId: string;
  readonly newOwnerMemberId: string;
}

/**
 * 所有权转让以活动锁为事务边界。成员角色使用单条 CASE 更新，避免部分唯一
 * Owner 索引观察到短暂的零 Owner 或双 Owner 状态。
 */
export class OwnershipService {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  async transferOwnership(input: TransferOwnershipInput): Promise<void> {
    await this.sql.begin(async (transaction) => {
      const actor = await authorizeActivityOperation(transaction, {
        session: input.session,
        activityId: input.activityId,
        operation: "OWNER_TRANSFER",
      });
      const [activity] =
        await transaction`select owner_member_id from activities where id = ${input.activityId} for update`;
      if (!activity || activity.owner_member_id !== actor.member.id) {
        throw new ApplicationError(
          "OWNER_TRANSFER_REQUIRED",
          "活动 Owner 已变化，请刷新后重试。",
          409,
        );
      }
      if (input.newOwnerMemberId === actor.member.id) {
        throw new ApplicationError(
          "INVALID_NEW_OWNER",
          "新 Owner 必须是另一位有效成员。",
          422,
        );
      }
      const [nextOwner] =
        await transaction`select id, user_id, status from activity_members where id = ${input.newOwnerMemberId} and activity_id = ${input.activityId} for update`;
      if (!nextOwner || nextOwner.status !== "ACTIVE") {
        throw new ApplicationError(
          "INVALID_NEW_OWNER",
          "新 Owner 必须是当前活动的有效成员。",
          422,
        );
      }

      await transaction`update activity_members
        set role = case when id = ${input.newOwnerMemberId} then 'OWNER'::activity_role else 'ADMIN'::activity_role end
        where id in (${input.newOwnerMemberId}, ${actor.member.id}) and activity_id = ${input.activityId}`;
      await transaction`update activities
        set owner_member_id = ${input.newOwnerMemberId}, revision = revision + 1, updated_at = now()
        where id = ${input.activityId}`;
      await transaction`insert into activity_audit_logs (id, activity_id, actor_user_id, actor_member_id, event_type, target_type, target_id, metadata)
        values (${randomUUID()}, ${input.activityId}, ${actor.userId}, ${actor.member.id}, 'OWNER_TRANSFERRED', 'ACTIVITY_MEMBER', ${input.newOwnerMemberId}, ${JSON.stringify({ from: actor.member.id, to: input.newOwnerMemberId })}::jsonb)`;
      if (nextOwner.user_id) {
        await transaction`insert into notifications (id, recipient_user_id, type, target_type, target_id, payload)
          values (${randomUUID()}, ${nextOwner.user_id}, 'OWNER_TRANSFERRED', 'ACTIVITY', ${input.activityId}, ${JSON.stringify({ activityId: input.activityId })}::jsonb)`;
      }
    });
  }
}
