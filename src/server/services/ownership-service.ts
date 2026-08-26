import { randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";

import { ApplicationError } from "@/server/errors/application-error";

type LockedCandidateMember = {
  id: string;
  userId: string | null;
  role: "OWNER" | "ADMIN" | "MEMBER";
  status: "ACTIVE" | "LEFT";
};

type LockedActivity = {
  ownerMemberId: string;
  deletedAt: Date | null;
};

/**
 * 活动所有权必须以成员角色、Owner 指针、审计和通知为一个事务整体转让。
 * 此服务是受信任的内部写入口；Session 与通用授权将在 Task 6 的路由层接入。
 */
export class OwnershipService {
  constructor(private readonly sql: Sql) {}

  async transferOwnership(
    activityId: string,
    actorMemberId: string,
    newOwnerMemberId: string,
  ): Promise<void> {
    await this.sql.begin(async (transaction) => {
      const candidates = await this.lockCandidateMembers(
        transaction,
        activityId,
        actorMemberId,
        newOwnerMemberId,
      );
      // 锁顺序固定为候选成员 ID 升序再锁活动，避免与成员服务及并发转让互相等待。
      const activity = await this.lockActivity(transaction, activityId);
      const actor = candidates.find((member) => member.id === actorMemberId);

      // 已取得活动锁后才依据当前 Owner 指针判断，防止使用过期的所有权关系写入。
      if (
        activity.ownerMemberId !== actorMemberId ||
        !actor ||
        actor.role !== "OWNER" ||
        actor.status !== "ACTIVE"
      ) {
        throw new ApplicationError(
          "ROLE_FORBIDDEN",
          "只有当前有效 Owner 可以转让活动所有权。",
          403,
        );
      }

      const newOwner = candidates.find(
        (member) => member.id === newOwnerMemberId,
      );
      if (
        newOwnerMemberId === actorMemberId ||
        !newOwner ||
        newOwner.status !== "ACTIVE"
      ) {
        throw new ApplicationError(
          "INVALID_NEW_OWNER",
          "新 Owner 必须是同一活动内另一名有效成员。",
          422,
        );
      }

      // 单条 CASE 更新保证语句结束时只留下一个 OWNER，兼容不可延迟的部分唯一索引。
      await transaction`
        update activity_members
        set role = case
          when id = ${newOwnerMemberId} then 'OWNER'::activity_role
          else 'ADMIN'::activity_role
        end
        where activity_id = ${activityId}
          and (id = ${actorMemberId} or id = ${newOwnerMemberId})
      `;
      await transaction`
        update activities
        set
          owner_member_id = ${newOwnerMemberId},
          revision = revision + 1,
          updated_at = now()
        where id = ${activityId}
      `;
      await transaction`
        insert into activity_audit_logs (
          id, activity_id, actor_user_id, actor_member_id, event_type, target_type, target_id, metadata
        )
        values (
          ${randomUUID()}, ${activityId}, ${actor.userId}, ${actorMemberId},
          'OWNER_TRANSFERRED', 'ACTIVITY', ${activityId},
          ${JSON.stringify({
            fromMemberId: actorMemberId,
            toMemberId: newOwnerMemberId,
          })}::jsonb
        )
      `;

      if (newOwner.userId) {
        await transaction`
          insert into notifications (
            id, recipient_user_id, type, target_type, target_id, payload
          )
          values (
            ${randomUUID()}, ${newOwner.userId}, 'OWNER_TRANSFERRED', 'ACTIVITY', ${activityId},
            ${JSON.stringify({ fromMemberId: actorMemberId, activityId })}::jsonb
          )
        `;
      }
    });
  }

  private async lockCandidateMembers(
    transaction: TransactionSql,
    activityId: string,
    actorMemberId: string,
    newOwnerMemberId: string,
  ): Promise<LockedCandidateMember[]> {
    return transaction<LockedCandidateMember[]>`
      select
        id,
        user_id as "userId",
        role,
        status
      from activity_members
      where activity_id = ${activityId}
        and (id = ${actorMemberId} or id = ${newOwnerMemberId})
      order by id
      for update
    `;
  }

  private async lockActivity(
    transaction: TransactionSql,
    activityId: string,
  ): Promise<LockedActivity> {
    const [activity] = await transaction<LockedActivity[]>`
      select
        owner_member_id as "ownerMemberId",
        deleted_at as "deletedAt"
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
}
