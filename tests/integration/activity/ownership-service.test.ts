import { afterAll, beforeAll, expect, it } from "vitest";

import {
  startPostgres,
  type PostgresHarness,
} from "@/../tests/support/postgres";
import { ActivityService } from "@/server/services/activity-service";
import { MemberService } from "@/server/services/member-service";
import { OwnershipService } from "@/server/services/ownership-service";

let harness: PostgresHarness;

beforeAll(async () => {
  harness = await startPostgres();
  await harness.seedCredentialUser("old-user", "old@example.com");
  await harness.seedCredentialUser("next-user", "next@example.com");
});

afterAll(async () => {
  await harness?.stop();
});

it("原子更新角色、Owner 指针、审计、通知和 Revision", async () => {
  const ownerSession = { user: { id: "old-user" } };
  const activity = await new ActivityService(harness.sql).create({
    session: ownerSession,
    name: "东京",
    baseCurrency: "CNY",
    startDate: "2026-08-23",
    ownerDisplayName: "旧 Owner",
  });
  const members = new MemberService(harness.sql, {
    hasFacts: async () => false,
  });
  const next = await members.addGuest({
    session: ownerSession,
    activityId: activity.id,
    displayName: "新 Owner",
  });
  await members.bindGuest({
    session: ownerSession,
    memberId: next.id,
    userId: "next-user",
  });

  await new OwnershipService(harness.sql).transferOwnership({
    session: ownerSession,
    activityId: activity.id,
    newOwnerMemberId: next.id,
  });

  const rows =
    await harness.sql`select id, role from activity_members where activity_id = ${activity.id} order by role`;
  const [updated] =
    await harness.sql`select owner_member_id, revision from activities where id = ${activity.id}`;
  const notifications =
    await harness.sql`select recipient_user_id from notifications where recipient_user_id = 'next-user'`;
  expect(rows).toEqual([
    { id: next.id, role: "OWNER" },
    { id: activity.ownerMemberId, role: "ADMIN" },
  ]);
  expect(updated).toEqual({ owner_member_id: next.id, revision: "3" });
  expect(notifications).toHaveLength(1);
});
