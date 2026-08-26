import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, expect, it } from "vitest";

import {
  startPostgres,
  type PostgresHarness,
} from "@/../tests/support/postgres";
import { ActivityService } from "@/server/services/activity-service";

let harness: PostgresHarness;
let activityId: string;
let memberId: string;
let expenseId: string;

beforeAll(async () => {
  harness = await startPostgres();
  await harness.seedCredentialUser("attachment-user", "attachment@example.com");
  const activity = await new ActivityService(harness.sql).create({
    session: { user: { id: "attachment-user" } },
    name: "附件验证活动",
    baseCurrency: "CNY",
    startDate: "2026-08-26",
    ownerDisplayName: "附件用户",
  });
  activityId = activity.id;
  memberId = activity.ownerMemberId;
  expenseId = randomUUID();
  await harness.sql`insert into expenses (id, activity_id, title, category, original_currency, original_amount_minor, base_currency, base_amount_minor, exchange_rate, exchange_rate_source, exchange_rate_at, split_mode, occurred_at, created_by_member_id, created_by_user_id, client_mutation_id, version)
    values (${expenseId}, ${activityId}, '晚餐', 'FOOD', 'CNY', 1000, 'CNY', 1000, 1, 'IDENTITY', now(), 'EQUAL', now(), ${memberId}, 'attachment-user', ${randomUUID()}, 1)`;
});

afterAll(async () => {
  await harness?.stop();
});

async function insertAttachment(
  clientAttachmentId: string,
  storageKey: string,
) {
  await harness.sql`insert into expense_attachments (id, expense_id, client_attachment_id, storage_key, safe_filename, mime_type, width, height, byte_size, sha256)
    values (${randomUUID()}, ${expenseId}, ${clientAttachmentId}, ${storageKey}, 'receipt.webp', 'image/webp', 100, 100, 1024, 'abc123')`;
}

it("同一消费重试相同 client_attachment_id 只能保留一条附件元数据", async () => {
  const clientAttachmentId = randomUUID();
  await insertAttachment(
    clientAttachmentId,
    `${activityId}/${expenseId}/first.webp`,
  );

  await expect(
    insertAttachment(
      clientAttachmentId,
      `${activityId}/${expenseId}/second.webp`,
    ),
  ).rejects.toMatchObject({ code: "23505" });
});
