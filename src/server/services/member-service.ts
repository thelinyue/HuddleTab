import { randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";

import { ApplicationError } from "@/server/errors/application-error";

/**
 * 用于判断成员是否已经被账目、分摊等不可变事实引用。
 * 有历史事实的成员不可删除，必须在当前事务中查询并保留原 ID 为 LEFT。
 */
export interface AccountingIdentityUsageReader {
  hasFacts(transaction: TransactionSql, memberId: string): Promise<boolean>;
}

export type ActivityMemberActor = {
  userId?: string;
  memberId?: string;
};

type LockedActivityMember = {
  activityId: string;
  memberType: "GUEST" | "USER";
  role: "OWNER" | "ADMIN" | "MEMBER";
};

/**
 * 成员写入在同一事务内完成成员事实、审计和活动 revision 更新。
 * 访客绑定只能改变关联账户，始终保留 activity_members.id 这个记账身份。
 */
export class MemberService {
  constructor(
    private readonly sql: Sql,
    private readonly usage: AccountingIdentityUsageReader,
  ) {}

  async addGuest(
    activityId: string,
    displayName: string,
    actor?: ActivityMemberActor,
  ): Promise<{ id: string }> {
    const memberId = randomUUID();

    await this.sql.begin(async (transaction) => {
      await transaction`
        insert into activity_members (
          id, activity_id, display_name, member_type, role, status
        )
        values (${memberId}, ${activityId}, ${displayName}, 'GUEST', 'MEMBER', 'ACTIVE')
      `;
      await this.writeAudit(
        transaction,
        activityId,
        "MEMBER_GUEST_ADDED",
        memberId,
        actor,
      );
      await this.incrementRevision(transaction, activityId);
    });

    return { id: memberId };
  }

  async bindGuest(
    memberId: string,
    userId: string,
    actor?: ActivityMemberActor,
  ): Promise<void> {
    await this.sql.begin(async (transaction) => {
      const member = await this.lockActivityMember(transaction, memberId);
      if (member.memberType !== "GUEST") {
        throw new ApplicationError(
          "MEMBER_NOT_GUEST",
          "只能将访客成员绑定到用户账户。",
          409,
        );
      }

      await transaction`
        update activity_members
        set user_id = ${userId}, member_type = 'USER'
        where id = ${memberId}
      `;
      await this.writeAudit(
        transaction,
        member.activityId,
        "MEMBER_GUEST_BOUND",
        memberId,
        actor,
      );
      await this.incrementRevision(transaction, member.activityId);
    });
  }

  async leave(memberId: string, actor?: ActivityMemberActor): Promise<void> {
    await this.sql.begin(async (transaction) => {
      const member = await this.lockActivityMember(transaction, memberId);
      this.assertNotOwner(member);

      await transaction`
        update activity_members
        set status = 'LEFT', left_at = now()
        where id = ${memberId}
      `;
      await this.writeAudit(
        transaction,
        member.activityId,
        "MEMBER_LEFT",
        memberId,
        actor,
      );
      await this.incrementRevision(transaction, member.activityId);
    });
  }

  async remove(memberId: string, actor?: ActivityMemberActor): Promise<void> {
    await this.sql.begin(async (transaction) => {
      const member = await this.lockActivityMember(transaction, memberId);
      this.assertNotOwner(member);

      if (await this.usage.hasFacts(transaction, memberId)) {
        await transaction`
          update activity_members
          set status = 'LEFT', left_at = now()
          where id = ${memberId}
        `;
        await this.writeAudit(
          transaction,
          member.activityId,
          "MEMBER_REMOVED_LEFT",
          memberId,
          actor,
        );
      } else {
        await transaction`delete from activity_members where id = ${memberId}`;
        await this.writeAudit(
          transaction,
          member.activityId,
          "MEMBER_REMOVED",
          memberId,
          actor,
        );
      }

      await this.incrementRevision(transaction, member.activityId);
    });
  }

  private async lockActivityMember(
    transaction: TransactionSql,
    memberId: string,
  ): Promise<LockedActivityMember> {
    const [member] = await transaction<LockedActivityMember[]>`
      select
        member.activity_id as "activityId",
        member.member_type as "memberType",
        member.role
      from activity_members member
      join activities activity on activity.id = member.activity_id
      where member.id = ${memberId}
      for update of member, activity
    `;

    if (!member) {
      throw new ApplicationError(
        "ACTIVITY_MEMBER_NOT_FOUND",
        "未找到指定的活动成员。",
        404,
      );
    }

    return member;
  }

  private assertNotOwner(member: LockedActivityMember): void {
    if (member.role === "OWNER") {
      throw new ApplicationError(
        "OWNER_TRANSFER_REQUIRED",
        "请先转让活动所有权，再退出或移除 Owner。",
        409,
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

  private async writeAudit(
    transaction: TransactionSql,
    activityId: string,
    eventType: string,
    memberId: string,
    actor?: ActivityMemberActor,
  ): Promise<void> {
    await transaction`
      insert into activity_audit_logs (
        id, activity_id, actor_user_id, actor_member_id, event_type, target_type, target_id, metadata
      )
      values (
        ${randomUUID()}, ${activityId}, ${actor?.userId ?? null}, ${actor?.memberId ?? null},
        ${eventType}, 'ACTIVITY_MEMBER', ${memberId}, '{}'::jsonb
      )
    `;
  }
}
