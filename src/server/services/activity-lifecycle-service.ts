import { randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";

import { ApplicationError } from "@/server/errors/application-error";

export type LifecycleAction =
  "END" | "REOPEN" | "ARCHIVE" | "UNARCHIVE" | "DELETE" | "RESTORE";

type ActivityStatus = "ACTIVE" | "ENDED" | "ARCHIVED";
type LockedActor = {
  id: string;
  userId: string | null;
  role: "OWNER" | "ADMIN" | "MEMBER";
  status: "ACTIVE" | "LEFT";
};
type LockedActivity = {
  id: string;
  ownerMemberId: string;
  status: ActivityStatus;
  deletedAt: Date | null;
  purgeAfter: Date | null;
};

const transitions: Record<
  Exclude<LifecycleAction, "DELETE" | "RESTORE">,
  { from: ActivityStatus; to: ActivityStatus }
> = {
  END: { from: "ACTIVE", to: "ENDED" },
  REOPEN: { from: "ENDED", to: "ACTIVE" },
  ARCHIVE: { from: "ENDED", to: "ARCHIVED" },
  UNARCHIVE: { from: "ARCHIVED", to: "ENDED" },
};

/**
 * 活动生命周期写入统一锁定操作者成员再锁定活动，并把状态、删除窗口、审计和 revision
 * 放入同一事务。删除只标记活动，不改写原状态，使恢复能够精确返回删除前的生命周期。
 */
export class ActivityLifecycleService {
  constructor(private readonly sql: Sql | TransactionSql) {}

  async transition(
    activityId: string,
    actorMemberId: string,
    action: LifecycleAction,
  ): Promise<void> {
    await this.withTransaction(async (transaction) => {
      const actor = await this.lockActor(
        transaction,
        activityId,
        actorMemberId,
      );
      // 全局顺序固定为成员后活动；先锁成员可与 Owner 转让、邀请管理安全并发。
      const activity = await this.lockActivity(transaction, activityId);
      const locked = this.requireActorAndActivity(actor, activity);
      this.assertTransitionState(locked.activity, action);
      this.assertActiveActor(locked.actor);
      this.assertRole(locked.actor, locked.activity, action);

      if (action === "DELETE") {
        await transaction`
          update activities
          set
            deleted_at = now(),
            purge_after = now() + interval '30 days',
            revision = revision + 1,
            updated_at = now()
          where id = ${activityId}
        `;
      } else if (action === "RESTORE") {
        if (!locked.activity.purgeAfter) {
          throw new ApplicationError(
            "RESTORE_WINDOW_EXPIRED",
            "活动已超过恢复期限，无法恢复。",
            409,
          );
        }
        const restored = await transaction<{ id: string }[]>`
          update activities
          set
            deleted_at = null,
            purge_after = null,
            revision = revision + 1,
            updated_at = now()
          where id = ${activityId} and purge_after > now()
          returning id
        `;
        if (restored.length === 0) {
          throw new ApplicationError(
            "RESTORE_WINDOW_EXPIRED",
            "活动已超过恢复期限，无法恢复。",
            409,
          );
        }
      } else {
        const transition = transitions[action];
        await transaction`
          update activities
          set
            status = ${transition.to},
            revision = revision + 1,
            updated_at = now()
          where id = ${activityId}
        `;
      }

      await transaction`
        insert into activity_audit_logs (
          id, activity_id, actor_user_id, actor_member_id, event_type, target_type, target_id, metadata
        ) values (
          ${randomUUID()}, ${activityId}, ${locked.actor.userId}, ${actorMemberId},
          ${`ACTIVITY_${action}`}, 'ACTIVITY', ${activityId}, '{}'::jsonb
        )
      `;
    });
  }

  /** 已由 HTTP 路由开启事务时复用它，避免授权和写入之间产生新的事务边界。 */
  private async withTransaction<T>(
    callback: (transaction: TransactionSql) => Promise<T>,
  ): Promise<T> {
    if ("begin" in this.sql) {
      return this.sql.begin(callback) as Promise<T>;
    }
    return callback(this.sql);
  }

  private async lockActor(
    transaction: TransactionSql,
    activityId: string,
    actorMemberId: string,
  ): Promise<LockedActor | undefined> {
    const [actor] = await transaction<LockedActor[]>`
      select
        id,
        user_id as "userId",
        role,
        status
      from activity_members
      where id = ${actorMemberId} and activity_id = ${activityId}
      for update
    `;
    return actor;
  }

  private async lockActivity(
    transaction: TransactionSql,
    activityId: string,
  ): Promise<LockedActivity | undefined> {
    const [activity] = await transaction<LockedActivity[]>`
      select
        id,
        owner_member_id as "ownerMemberId",
        status,
        deleted_at as "deletedAt",
        purge_after as "purgeAfter"
      from activities
      where id = ${activityId}
      for update
    `;
    return activity;
  }

  private requireActorAndActivity(
    actor: LockedActor | undefined,
    activity: LockedActivity | undefined,
  ): { actor: LockedActor; activity: LockedActivity } {
    if (!activity || !actor) {
      throw new ApplicationError(
        "ACTIVITY_NOT_FOUND",
        "活动不存在，或您不是该活动成员。",
        404,
      );
    }
    return { actor, activity };
  }

  private assertTransitionState(
    activity: LockedActivity,
    action: LifecycleAction,
  ): void {
    const valid =
      action === "RESTORE"
        ? activity.deletedAt !== null
        : action === "DELETE"
          ? activity.deletedAt === null
          : activity.deletedAt === null &&
            activity.status === transitions[action].from;
    if (!valid) {
      throw new ApplicationError(
        "INVALID_ACTIVITY_TRANSITION",
        "当前活动状态不能执行此转换。",
        409,
      );
    }
  }

  private assertActiveActor(actor: LockedActor): void {
    if (actor.status !== "ACTIVE") {
      throw new ApplicationError(
        "LEFT_MEMBER_READ_ONLY",
        "您已离开活动，不能执行此操作。",
        403,
      );
    }
  }

  private assertRole(
    actor: LockedActor,
    activity: LockedActivity,
    action: LifecycleAction,
  ): void {
    const ownerOnly =
      action === "ARCHIVE" ||
      action === "UNARCHIVE" ||
      action === "DELETE" ||
      action === "RESTORE";
    if (
      (ownerOnly &&
        (actor.role !== "OWNER" || activity.ownerMemberId !== actor.id)) ||
      (!ownerOnly && actor.role === "MEMBER")
    ) {
      throw new ApplicationError(
        "ROLE_FORBIDDEN",
        "当前成员角色无权执行此操作。",
        403,
      );
    }
  }
}
