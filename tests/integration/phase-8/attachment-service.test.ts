import { randomUUID } from "node:crypto";

import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import {
  startPostgres,
  type PostgresHarness,
} from "@/../tests/support/postgres";
import { ActivityService } from "@/server/services/activity-service";
import { AttachmentService } from "@/server/services/attachment-service";

let harness: PostgresHarness;
let activityId: string;
let ownerMemberId: string;
let expenseId: string;
let imageBytes: Buffer;
const files = new Map<string, Buffer>();
const ownerSession = { user: { id: "attachment-owner" } };
const leftSession = { user: { id: "attachment-left" } };

const store = {
  async write(key: string, bytes: Buffer) {
    files.set(key, bytes);
  },
  async read(key: string) {
    const value = files.get(key);
    if (!value) throw new Error("附件文件不存在");
    return value;
  },
  async remove(key: string) {
    files.delete(key);
  },
};

function uploadInput(clientAttachmentId = randomUUID()) {
  return {
    session: ownerSession,
    activityId,
    expenseId,
    clientAttachmentId,
    declaredMime: "image/png",
    bytes: imageBytes,
  };
}

beforeAll(async () => {
  harness = await startPostgres();
  await harness.seedCredentialUser(ownerSession.user.id, "owner@example.com");
  await harness.seedCredentialUser(leftSession.user.id, "left@example.com");
  const activity = await new ActivityService(harness.sql).create({
    session: ownerSession,
    name: "附件服务活动",
    baseCurrency: "CNY",
    startDate: "2026-08-26",
    ownerDisplayName: "Owner",
  });
  activityId = activity.id;
  ownerMemberId = activity.ownerMemberId;
  await harness.sql`insert into activity_members (id, activity_id, user_id, display_name, member_type, role, status, joined_at, left_at)
    values (${randomUUID()}, ${activityId}, ${leftSession.user.id}, 'Left', 'USER', 'MEMBER', 'LEFT', now(), now())`;
  imageBytes = await sharp({
    create: { width: 1, height: 1, channels: 4, background: "#ffffff" },
  })
    .png()
    .toBuffer();
});

beforeEach(async () => {
  expenseId = randomUUID();
  files.clear();
  await harness.sql`insert into expenses (id, activity_id, title, category, original_currency, original_amount_minor, base_currency, base_amount_minor, exchange_rate, exchange_rate_source, exchange_rate_at, split_mode, occurred_at, created_by_member_id, created_by_user_id, client_mutation_id, version)
    values (${expenseId}, ${activityId}, '晚餐', 'FOOD', 'CNY', 1000, 'CNY', 1000, 1, 'IDENTITY', now(), 'EQUAL', now(), ${ownerMemberId}, ${ownerSession.user.id}, ${randomUUID()}, 1)`;
});

afterAll(async () => {
  await harness?.stop();
});

it("同一 clientAttachmentId 重试返回已有附件且只写入一条元数据", async () => {
  const service = new AttachmentService(harness.sql, store);
  const input = uploadInput();

  const first = await service.upload(input);
  const second = await service.upload(input);

  expect(second.idempotentReplay).toBe(true);
  expect(second.attachment.id).toBe(first.attachment.id);
  expect(
    await harness.sql`select id from expense_attachments where expense_id = ${expenseId} and client_attachment_id = ${input.clientAttachmentId}`,
  ).toHaveLength(1);
});

it("LEFT 成员可读取历史附件，但不能上传", async () => {
  const service = new AttachmentService(harness.sql, store);
  const uploaded = await service.upload(uploadInput());

  await expect(
    service.download(
      leftSession,
      activityId,
      expenseId,
      uploaded.attachment.id,
    ),
  ).resolves.toMatchObject({ mimeType: "image/webp" });
  await expect(
    service.upload({ ...uploadInput(), session: leftSession }),
  ).rejects.toMatchObject({ code: "LEFT_MEMBER_READ_ONLY" });
});

it("非成员下载返回私有 404", async () => {
  const service = new AttachmentService(harness.sql, store);
  const uploaded = await service.upload(uploadInput());

  await expect(
    service.download(
      { user: { id: "not-a-member" } },
      activityId,
      expenseId,
      uploaded.attachment.id,
    ),
  ).rejects.toMatchObject({ code: "ACTIVITY_NOT_FOUND", status: 404 });
});

it("下载不接受其他消费路径下的附件 ID", async () => {
  const service = new AttachmentService(harness.sql, store);
  const uploaded = await service.upload(uploadInput());

  await expect(
    service.download(
      leftSession,
      activityId,
      randomUUID(),
      uploaded.attachment.id,
    ),
  ).rejects.toMatchObject({ code: "ATTACHMENT_NOT_FOUND", status: 404 });
});

it("每笔消费最多保存三张附件", async () => {
  const service = new AttachmentService(harness.sql, store);
  await service.upload(uploadInput());
  await service.upload(uploadInput());
  await service.upload(uploadInput());

  await expect(service.upload(uploadInput())).rejects.toMatchObject({
    code: "ATTACHMENT_LIMIT_REACHED",
    status: 422,
  });
});
