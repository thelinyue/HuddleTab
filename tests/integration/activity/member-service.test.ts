import { afterAll, beforeAll, expect, it } from "vitest";

import {
  startPostgres,
  type PostgresHarness,
} from "@/../tests/support/postgres";
import { ActivityService } from "@/server/services/activity-service";
import { MemberService } from "@/server/services/member-service";

let harness: PostgresHarness;

beforeAll(async () => {
  harness = await startPostgres();
  await harness.seedCredentialUser("user-1", "owner@example.com");
  await harness.seedCredentialUser("user-2", "member@example.com");
});

afterAll(async () => {
  await harness?.stop();
});

it("在一个事务中创建 Owner，并在绑定 Guest 时保持账务身份 ID", async () => {
  const session = { user: { id: "user-1" } };
  const activity = await new ActivityService(harness.sql).create({
    session,
    name: "大阪",
    baseCurrency: "CNY",
    startDate: "2026-08-23",
    ownerDisplayName: "Owner",
  });
  const members = new MemberService(harness.sql, {
    hasFacts: async () => false,
  });
  const guest = await members.addGuest({
    session,
    activityId: activity.id,
    displayName: "小王",
  });
  await members.bindGuest({
    session,
    memberId: guest.id,
    userId: "user-2",
  });

  const [row] =
    await harness.sql`select id, user_id, member_type from activity_members where id = ${guest.id}`;
  expect(row).toEqual({
    id: guest.id,
    user_id: "user-2",
    member_type: "USER",
  });
});
