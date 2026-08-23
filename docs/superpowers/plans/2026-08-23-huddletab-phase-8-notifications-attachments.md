# HuddleTab Phase 8 Notifications and Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现仅应用内通知，以及本地私有、可幂等重试的 Expense 图片附件。

**Architecture:** 通知与业务事实共用事务；附件在 Expense 成功后独立上传。图片经 MIME、Magic Bytes、大小和尺寸校验后重编码到 `/data/uploads`，数据库只保存元数据，下载必须重新校验活动成员身份。

**Tech Stack:** Next.js App Router, TypeScript, Drizzle ORM, PostgreSQL 18, Sharp, file-type, Vitest, Testcontainers, Playwright.

---

## File responsibility map

```text
src/server/db/schema/notifications.ts                 通知表与稳定事件类型
src/server/db/schema/expense-attachments.ts          附件元数据与幂等约束
src/server/services/notification-service.ts          事务内写入、列表、未读和已读
src/app/api/notifications/**                         接收人范围内的通知 API
src/server/attachments/image-policy.ts               图片安全校验与重编码
src/server/attachments/local-attachment-store.ts     私有目录安全读写
src/server/services/attachment-service.ts            权限、三张限制、幂等和文件补偿
src/app/api/activities/[activityId]/expenses/[expenseId]/attachments/**
                                                       上传与受控下载
src/server/jobs/orphan-attachment-cleanup.ts         单进程孤立文件清理
```

### Task 1: Reuse notification schema and add attachment tables

**Files:**
- Modify: `src/server/db/schema/activity.ts` (reuse the Phase 3 `notifications` table; do not recreate it)
- Create: `src/server/db/schema/expense-attachments.ts`
- Modify: `src/server/db/schema/index.ts`
- Test: `tests/integration/phase-8/schema.test.ts`
- Create: generated migration under `drizzle/`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, it } from "vitest";
import { createPostgresTestContext } from "../support/postgres-test-context";

it("enforces attachment retry idempotency", async () => {
  const ctx = await createPostgresTestContext();
  const ids = await ctx.seedExpense();
  await ctx.insertAttachment({ ...ids, clientAttachmentId: "57d79eb0-8611-4e82-815b-b1cfdf859b74" });
  await expect(ctx.insertAttachment({ ...ids, clientAttachmentId: "57d79eb0-8611-4e82-815b-b1cfdf859b74" }))
    .rejects.toMatchObject({ code: "23505" });
  await ctx.close();
});
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:integration -- tests/integration/phase-8/schema.test.ts`

Expected: FAIL with `relation "expense_attachments" does not exist`.

- [ ] **Step 3: Implement the schema**

```ts
export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey(),
  recipientUserId: uuid("recipient_user_id").notNull().references(() => users.id),
  type: text("type").notNull(),
  targetType: text("target_type").notNull(),
  targetId: uuid("target_id").notNull(),
  payload: jsonb("payload").notNull().$type<Record<string, string>>(),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const expenseAttachments = pgTable("expense_attachments", {
  id: uuid("id").primaryKey(),
  expenseId: uuid("expense_id").notNull().references(() => expenses.id, { onDelete: "cascade" }),
  clientAttachmentId: uuid("client_attachment_id").notNull(),
  storageKey: text("storage_key").notNull().unique(),
  safeFilename: text("safe_filename").notNull(),
  mimeType: text("mime_type").notNull(),
  width: integer("width").notNull(), height: integer("height").notNull(),
  byteSize: bigint("byte_size", { mode: "number" }).notNull(),
  sha256: text("sha256").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("expense_attachments_expense_client_uidx").on(t.expenseId, t.clientAttachmentId)]);
```

Run: `npm run db:generate`

- [ ] **Step 4: Verify pass**

Run: `npm run test:integration -- tests/integration/phase-8/schema.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/schema drizzle tests/integration/phase-8/schema.test.ts
git commit -m "feat: add notification and attachment metadata"
```

### Task 2: Implement server-backed in-app notifications

**Files:**
- Create: `src/server/services/notification-service.ts`
- Create: `src/app/api/notifications/route.ts`
- Create: `src/app/api/notifications/[notificationId]/read/route.ts`
- Modify: Phase 3–5 transaction services for confirmed events
- Test: `tests/integration/phase-8/notification-service.test.ts`
- Test: `tests/api/notifications.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
it("rolls notification back with the business transaction", async () => {
  const seed = await ctx.seedActivityMember();
  await expect(ctx.db.transaction(async (tx) => {
    await service.create(tx, { recipientUserId: seed.userId, type: "ACTIVITY_STATUS_CHANGED",
      targetType: "activity", targetId: seed.activityId, payload: { status: "ENDED" } });
    throw new Error("模拟事务失败");
  })).rejects.toThrow("模拟事务失败");
  expect(await ctx.countNotifications(seed.userId)).toBe(0);
});

it("cannot mark another user's notification read", async () => {
  const response = await api.post(`/api/notifications/${aliceNotification.id}/read`, {}, bob.session);
  expect(response.status).toBe(404);
  expect((await response.json()).error.code).toBe("NOTIFICATION_NOT_FOUND");
});
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:integration -- tests/integration/phase-8/notification-service.test.ts && npm run test:unit -- tests/api/notifications.test.ts`

Expected: FAIL because service/routes do not exist.

- [ ] **Step 3: Implement minimal service and routes**

```ts
export const notificationTypes = [
  "ACTIVITY_INVITATION", "JOIN_APPROVAL_REQUESTED", "JOIN_APPROVAL_RESOLVED",
  "PARTICIPATING_EXPENSE_CHANGED", "PARTICIPATING_EXPENSE_DELETED",
  "SETTLEMENT_RECEIVED", "ACTIVITY_STATUS_CHANGED", "OWNERSHIP_CHANGED",
] as const;

export class NotificationService {
  /** 写入器不自行开启事务，确保事实、Audit、Revision 与通知共同提交或回滚。 */
  create(tx: DbTransaction, input: CreateNotificationInput) {
    return tx.insert(notifications).values({ id: randomUUID(), ...input });
  }
  list(recipientUserId: string, limit: number) {
    return this.repository.listForRecipient(recipientUserId, Math.min(limit, 50));
  }
  async markRead(recipientUserId: string, id: string) {
    if (!await this.repository.markReadForRecipient(recipientUserId, id))
      throw new AppError(404, "NOTIFICATION_NOT_FOUND", "通知不存在或你无权查看。");
  }
  constructor(private readonly repository: NotificationRepository) {}
}
```

`GET /api/notifications` returns `{ data: { items, unreadCount } }`; `POST .../read` scopes the update by Session user. Integrate only the eight types above. Ordinary Expense creation emits nothing. Payload contains display-safe names/status only. UI deep links are built from known `targetType` and UUID, never arbitrary payload URLs. No Web Push is added.

- [ ] **Step 4: Verify pass**

Run: `npm run test:integration -- tests/integration/phase-8/notification-service.test.ts && npm run test:unit -- tests/api/notifications.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/notification-service.ts src/app/api/notifications src/server/services tests/integration/phase-8/notification-service.test.ts tests/api/notifications.test.ts
git commit -m "feat: add in-app notifications"
```

### Task 3: Validate, re-encode and privately store images

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `src/server/attachments/image-policy.ts`
- Create: `src/server/attachments/local-attachment-store.ts`
- Test: `tests/unit/attachments/security.test.ts`

- [ ] **Step 1: Install and write the failing test**

Run: `npm install sharp file-type`

```ts
it.each([
  [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), "image/svg+xml", "ATTACHMENT_TYPE_NOT_ALLOWED"],
  [Buffer.alloc(10 * 1024 * 1024 + 1), "image/jpeg", "ATTACHMENT_TOO_LARGE"],
])("rejects unsafe image", async (bytes, mime, code) => {
  await expect(processAttachmentImage(bytes, mime)).rejects.toMatchObject({ code });
});

it("rejects traversal", async () => {
  await expect(new LocalAttachmentStore(tempRoot).read("../../outside"))
    .rejects.toMatchObject({ code: "ATTACHMENT_STORAGE_KEY_INVALID" });
});
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:unit -- tests/unit/attachments/security.test.ts`

Expected: FAIL with missing modules.

- [ ] **Step 3: Implement image and path policy**

```ts
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

/** MIME 声明不可信；先限大小，再核对 Magic Bytes，最后重编码并移除原始元数据。 */
export async function processAttachmentImage(bytes: Buffer, declaredMime: string) {
  if (bytes.byteLength > MAX_BYTES) throw new AppError(422, "ATTACHMENT_TOO_LARGE", "图片不能超过 10MB。");
  if (!ALLOWED.has(declaredMime)) throw new AppError(422, "ATTACHMENT_TYPE_NOT_ALLOWED", "仅支持 JPG、PNG 或 WebP，SVG 不受支持。");
  const detected = await fileTypeFromBuffer(bytes);
  if (!detected || !ALLOWED.has(detected.mime)) throw new AppError(422, "ATTACHMENT_TYPE_NOT_ALLOWED", "无法识别安全图片格式。");
  if (detected.mime !== declaredMime) throw new AppError(422, "ATTACHMENT_MIME_MISMATCH", "图片类型与内容不一致。");
  const output = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate()
    .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 }).toBuffer();
  const meta = await sharp(output).metadata();
  return { bytes: output, mimeType: "image/webp", width: meta.width!, height: meta.height!,
    byteSize: output.byteLength, sha256: createHash("sha256").update(output).digest("hex") };
}

private resolveKey(key: string) {
  const root = resolve(this.uploadsRoot); const target = resolve(root, key); const rel = relative(root, target);
  if (!key || isAbsolute(key) || rel.startsWith("..") || isAbsolute(rel))
    throw new AppError(400, "ATTACHMENT_STORAGE_KEY_INVALID", "附件存储路径无效。");
  return target;
}
```

`LocalAttachmentStore.write()` uses generated keys, `0600` temporary files and atomic rename. It never accepts the original filename as a path.

- [ ] **Step 4: Verify pass**

Run: `npm run test:unit -- tests/unit/attachments/security.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/server/attachments tests/unit/attachments/security.test.ts
git commit -m "feat: secure local image processing"
```

### Task 4: Add authorized attachment APIs, retry and cleanup

**Files:**
- Create: `src/server/services/attachment-service.ts`
- Create: `src/app/api/activities/[activityId]/expenses/[expenseId]/attachments/route.ts`
- Create: `src/app/api/activities/[activityId]/expenses/[expenseId]/attachments/[attachmentId]/route.ts`
- Create: `src/server/jobs/orphan-attachment-cleanup.ts`
- Modify: `src/features/attachments/expense-attachments.tsx`
- Test: `tests/integration/phase-8/attachment-service.test.ts`
- Test: `tests/e2e/notifications-attachments.spec.ts`

- [ ] **Step 1: Write failing tests**

```ts
it("is idempotent and keeps LEFT read-only", async () => {
  const seed = await ctx.seedExpenseWithLeftMember();
  const input = await ctx.validUpload(seed.ownerUserId, seed, clientAttachmentId);
  const first = await service.upload(input); const second = await service.upload(input);
  expect(second.id).toBe(first.id);
  await expect(service.download(seed.leftUserId, seed.activityId, first.id)).resolves.toBeDefined();
  await expect(service.upload(await ctx.validUpload(seed.leftUserId, seed, crypto.randomUUID())))
    .rejects.toMatchObject({ code: "LEFT_MEMBER_EXPENSE_READ_ONLY" });
});

test("attachment retries without rolling back Expense", async ({ page, context }) => {
  await context.route("**/attachments", (r) => r.fulfill({ status: 503 }));
  await page.goto("/activities/test/expenses/new");
  await page.getByLabel("用途").fill("晚餐"); await page.getByLabel("金额").fill("88");
  await page.getByLabel("附件").setInputFiles("tests/fixtures/images/receipt.jpg");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("账单已同步，附件待同步")).toBeVisible();
});
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:integration -- tests/integration/phase-8/attachment-service.test.ts && npm run test:e2e -- tests/e2e/notifications-attachments.spec.ts`

Expected: FAIL because service/UI are absent.

- [ ] **Step 3: Implement minimal service**

```ts
/** 文件先落盘再写元数据；元数据失败删除文件，进程中断遗留物由清理任务收敛。 */
async upload(input: UploadAttachmentInput) {
  await permissions.requireExpenseAttachmentWrite(input.actorUserId, input.activityId, input.expenseId);
  const existing = await repository.findByClientId(input.expenseId, input.clientAttachmentId);
  if (existing) return existing;
  if (await repository.hasThreeForExpense(input.expenseId))
    throw new AppError(422, "ATTACHMENT_LIMIT_REACHED", "每笔消费最多上传 3 张图片。");
  const image = await processAttachmentImage(input.bytes, input.declaredMime);
  const id = randomUUID(); const storageKey = `${input.activityId}/${input.expenseId}/${id}.webp`;
  await store.write(storageKey, image.bytes);
  try { return await repository.insert({ id, storageKey, safeFilename: `${id}.webp`, ...input, ...image }); }
  catch (error) { await store.remove(storageKey); throw error; }
}
```

Upload reuses fixed permission order; LEFT/ENDED/ARCHIVED/DELETED cannot upload. Download calls `requireHistoricalActivityRead()` and returns `Cache-Control: private, no-store`, `Content-Type: image/webp`, `X-Content-Type-Options: nosniff`; non-members receive private `404`. UI uses Phase 7 `pending_attachments` and `client_attachment_id`. Cleanup deletes only files older than 24 hours with no metadata row, logs Chinese counts only, and is skipped while Phase 9 Maintenance Mode is active.

- [ ] **Step 4: Run Phase 8 gate**

Run: `npm run format:check && npm run lint && npm run typecheck && npm run test:unit && npm run test:integration && npm run test:e2e -- tests/e2e/notifications-attachments.spec.ts && npm run build`

Expected: PASS; no API response contains `/data/uploads` or `storageKey`.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/attachment-service.ts src/app/api/activities src/server/jobs/orphan-attachment-cleanup.ts src/features/attachments tests/integration/phase-8 tests/e2e/notifications-attachments.spec.ts
git commit -m "feat: complete secure attachment flow"
```

## Phase 8 acceptance boundary

- 仅应用内通知；无 Web Push、消息队列或 WebSocket。
- 每笔最多 3 张，原图最多 10MB，拒绝 SVG，核对 Magic Bytes，重编码并限制最长边 2048px。
- 文件只在 `/data/uploads`，不进入 `public/`；LEFT 仅历史读取。
- `(expense_id, client_attachment_id)` 保证重试幂等；附件失败不回滚 Expense。
- Phase 9 完整备份必须包含 Uploads，Restore 期间暂停上传和清理。
