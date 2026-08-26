import { randomUUID } from "node:crypto";

import type postgres from "postgres";

import {
  authorizeActivityOperation,
  type ActivityAuthorizationInput,
} from "@/server/permissions/authorize-activity-operation";
import { ApplicationError } from "@/server/errors/application-error";

export interface AccountingIdentityUsageReader {
  hasFacts(memberId: string): Promise<boolean>;
}

type MemberActor = Pick<ActivityAuthorizationInput, "session">;

/**
 * ActivityMember 永远是账务身份本体。Guest 绑定账号只修改 user_id/member_type，
 * 不更换 member ID；有历史账务的成员则转为 LEFT，绝不物理删除。
 */
export class MemberService {
  constructor(
    private readonly sql: ReturnType<typeof postgres>,
    private readonly usage: AccountingIdentityUsageReader,
  ) {}

  async addGuest(
    input: MemberActor & {
      readonly activityId: string;
      readonly displayName: string;
    },
  ): Promise<{ id: string }> {
    const id = randomUUID();
    await this.sql.begin(async (transaction) => {
      const actor = await authorizeActivityOperation(transaction, {
        session: input.session,
        activityId: input.activityId,
        operation: "MEMBER_MANAGE",
      });
      await transaction`insert into activity_members (id, activity_id, display_name, member_type, role, status, joined_at)
        values (${id}, ${input.activityId}, ${input.displayName}, 'GUEST', 'MEMBER', 'ACTIVE', now())`;
      await this.auditAndRevise(
        transaction,
        input.activityId,
        actor.member.id,
        actor.userId,
        "MEMBER_GUEST_ADDED",
        id,
      );
    });
    return { id };
  }

  async bindGuest(
    input: MemberActor & {
      readonly memberId: string;
      readonly userId: string;
    },
  ): Promise<void> {
    await this.sql.begin(async (transaction) => {
      const [member] =
        await transaction`select id, activity_id, member_type, user_id from activity_members where id = ${input.memberId} for update`;
      if (
        !member ||
        member.member_type !== "GUEST" ||
        member.user_id !== null
      ) {
        throw new ApplicationError(
          "GUEST_NOT_FOUND",
          "临时成员不存在或已经绑定账号。",
          404,
        );
      }
      const actor = await authorizeActivityOperation(transaction, {
        session: input.session,
        activityId: member.activity_id,
        operation: "MEMBER_MANAGE",
      });
      await transaction`update activity_members set user_id = ${input.userId}, member_type = 'USER' where id = ${input.memberId}`;
      await this.auditAndRevise(
        transaction,
        member.activity_id,
        actor.member.id,
        actor.userId,
        "MEMBER_BOUND",
        input.memberId,
      );
    });
  }

  async leave(
    input: MemberActor & { readonly activityId: string },
  ): Promise<void> {
    await this.sql.begin(async (transaction) => {
      const actor = await authorizeActivityOperation(transaction, {
        session: input.session,
        activityId: input.activityId,
        operation: "READ",
      });
      const [member] =
        await transaction`select role, status from activity_members where id = ${actor.member.id} for update`;
      if (member?.role === "OWNER") {
        throw new ApplicationError(
          "OWNER_TRANSFER_REQUIRED",
          "请先转让活动所有权，再退出活动。",
          409,
        );
      }
      if (member?.status === "ACTIVE") {
        await transaction`update activity_members set status = 'LEFT', left_at = now() where id = ${actor.member.id}`;
        await this.auditAndRevise(
          transaction,
          input.activityId,
          actor.member.id,
          actor.userId,
          "MEMBER_LEFT",
          actor.member.id,
        );
      }
    });
  }

  async remove(
    input: MemberActor & {
      readonly activityId: string;
      readonly memberId: string;
    },
  ): Promise<void> {
    await this.sql.begin(async (transaction) => {
      const actor = await authorizeActivityOperation(transaction, {
        session: input.session,
        activityId: input.activityId,
        operation: "MEMBER_MANAGE",
      });
      const [member] =
        await transaction`select role from activity_members where id = ${input.memberId} and activity_id = ${input.activityId} for update`;
      if (!member) {
        throw new ApplicationError("MEMBER_NOT_FOUND", "成员不存在。", 404);
      }
      if (member.role === "OWNER") {
        throw new ApplicationError(
          "OWNER_TRANSFER_REQUIRED",
          "请先转让活动所有权，再移除 Owner。",
          409,
        );
      }
      if (await this.usage.hasFacts(input.memberId)) {
        await transaction`update activity_members set status = 'LEFT', left_at = now() where id = ${input.memberId}`;
      } else {
        await transaction`delete from activity_members where id = ${input.memberId}`;
      }
      await this.auditAndRevise(
        transaction,
        input.activityId,
        actor.member.id,
        actor.userId,
        "MEMBER_REMOVED",
        input.memberId,
      );
    });
  }

  private async auditAndRevise(
    transaction: postgres.TransactionSql,
    activityId: string,
    actorMemberId: string,
    actorUserId: string,
    eventType: string,
    targetId: string,
  ): Promise<void> {
    await transaction`insert into activity_audit_logs (id, activity_id, actor_user_id, actor_member_id, event_type, target_type, target_id, metadata)
      values (${randomUUID()}, ${activityId}, ${actorUserId}, ${actorMemberId}, ${eventType}, 'ACTIVITY_MEMBER', ${targetId}, '{}'::jsonb)`;
    await transaction`update activities set revision = revision + 1, updated_at = now() where id = ${activityId}`;
  }
}
