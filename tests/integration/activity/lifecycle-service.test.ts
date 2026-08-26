import { afterAll, beforeAll, expect, it } from "vitest";

import {
  startPostgres,
  type PostgresHarness,
} from "@/../tests/support/postgres";
import { ActivityLifecycleService } from "@/server/services/activity-lifecycle-service";
import { ActivityService } from "@/server/services/activity-service";

let harness: PostgresHarness;
let activityId: string;
const ownerSession = { user: { id: "owner-user" } };

beforeAll(async () => {
  harness = await startPostgres();
  await harness.seedCredentialUser("owner-user", "owner@example.com");
  activityId = (
    await new ActivityService(harness.sql).create({
      session: ownerSession,
      name: "京都",
      baseCurrency: "CNY",
      startDate: "2026-08-23",
      ownerDisplayName: "Owner",
    })
  ).id;
});

afterAll(async () => {
  await harness?.stop();
});

it("遵循生命周期状态机并保留删除前状态和 Revision", async () => {
  const service = new ActivityLifecycleService(harness.sql);
  await service.transition({
    session: ownerSession,
    activityId,
    action: "END",
  });
  await service.transition({
    session: ownerSession,
    activityId,
    action: "ARCHIVE",
  });
  await service.transition({
    session: ownerSession,
    activityId,
    action: "DELETE",
  });
  await service.transition({
    session: ownerSession,
    activityId,
    action: "RESTORE",
  });

  const [activity] =
    await harness.sql`select status, deleted_at, purge_after, revision from activities where id = ${activityId}`;
  expect(activity?.status).toBe("ARCHIVED");
  expect(activity?.deleted_at).toBeNull();
  expect(activity?.purge_after).toBeNull();
  expect(activity?.revision).toBe("4");
});
