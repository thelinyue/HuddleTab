import { randomUUID } from "node:crypto";

import type postgres from "postgres";

import { ApplicationError } from "@/server/errors/application-error";
import {
  authorizeActivityOperation,
  type ActivityAuthorizationInput,
} from "@/server/permissions/authorize-activity-operation";
import { NotificationService } from "@/server/services/notification-service";

export type LifecycleAction =
  "END" | "REOPEN" | "ARCHIVE" | "UNARCHIVE" | "DELETE" | "RESTORE";

const transitions: Record<
  Exclude<LifecycleAction, "DELETE" | "RESTORE">,
  readonly [from: string, to: string]
> = {
  END: ["ACTIVE", "ENDED"],
  REOPEN: ["ENDED", "ACTIVE"],
  ARCHIVE: ["ENDED", "ARCHIVED"],
  UNARCHIVE: ["ARCHIVED", "ENDED"],
};
const ownerOnlyActions: readonly LifecycleAction[] = [
  "ARCHIVE",
  "UNARCHIVE",
  "DELETE",
  "RESTORE",
];
const managerActions: readonly LifecycleAction[] = ["END", "REOPEN"];

/** 活动状态只按显式矩阵变化；删除保留原状态，以便 30 天内无损恢复。 */
export class ActivityLifecycleService {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  async transition(input: {
    readonly session: ActivityAuthorizationInput["session"];
    readonly activityId: string;
    readonly action: LifecycleAction;
  }): Promise<void> {
    await this.sql.begin(async (transaction) => {
      const notifications = new NotificationService(this.sql);
      const actor = await authorizeActivityOperation(transaction, {
        session: input.session,
        activityId: input.activityId,
        operation: "ACTIVITY_LIFECYCLE",
      });
      const [activity] =
        await transaction`select status, deleted_at, purge_after from activities where id = ${input.activityId} for update`;
      const [member] =
        await transaction`select role, status from activity_members where id = ${actor.member.id} for update`;
      if (!activity || !member || member.status !== "ACTIVE") {
        throw new ApplicationError(
          "ACTIVITY_NOT_FOUND",
          "活动不存在或你无权操作。",
          404,
        );
      }
      if (ownerOnlyActions.includes(input.action) && member.role !== "OWNER") {
        throw new ApplicationError(
          "ROLE_FORBIDDEN",
          "只有 Owner 可以执行此操作。",
          403,
        );
      }
      if (managerActions.includes(input.action) && member.role === "MEMBER") {
        throw new ApplicationError(
          "ROLE_FORBIDDEN",
          "当前角色不能改变活动状态。",
          403,
        );
      }

      let notificationStatus: string;
      if (input.action === "DELETE") {
        if (activity.deleted_at) this.invalidTransition();
        await transaction`update activities set deleted_at = now(), purge_after = now() + interval '30 days', revision = revision + 1, updated_at = now() where id = ${input.activityId}`;
        notificationStatus = "DELETED";
      } else if (input.action === "RESTORE") {
        if (
          !activity.deleted_at ||
          !activity.purge_after ||
          activity.purge_after <= new Date()
        ) {
          throw new ApplicationError(
            "RESTORE_WINDOW_EXPIRED",
            "活动已超过 30 天恢复期限。",
            409,
          );
        }
        await transaction`update activities set deleted_at = null, purge_after = null, revision = revision + 1, updated_at = now() where id = ${input.activityId}`;
        notificationStatus = "RESTORED";
      } else {
        const [from, to] = transitions[input.action];
        if (activity.deleted_at || activity.status !== from)
          this.invalidTransition();
        await transaction`update activities set status = ${to}, revision = revision + 1, updated_at = now() where id = ${input.activityId}`;
        notificationStatus = to;
      }
      await transaction`insert into activity_audit_logs (id, activity_id, actor_user_id, actor_member_id, event_type, target_type, target_id, metadata)
        values (${randomUUID()}, ${input.activityId}, ${actor.userId}, ${actor.member.id}, ${`ACTIVITY_${input.action}`}, 'ACTIVITY', ${input.activityId}, '{}'::jsonb)`;
      const recipients =
        await transaction`select user_id from activity_members where activity_id = ${input.activityId} and user_id is not null and user_id <> ${actor.userId}`;
      for (const recipient of recipients) {
        await notifications.create(transaction, {
          recipientUserId: recipient.user_id,
          type: "ACTIVITY_STATUS_CHANGED",
          targetType: "ACTIVITY",
          targetId: input.activityId,
          payload: { status: notificationStatus },
        });
      }
    });
  }

  private invalidTransition(): never {
    throw new ApplicationError(
      "INVALID_ACTIVITY_TRANSITION",
      "当前活动状态不能执行此转换。",
      409,
    );
  }
}
