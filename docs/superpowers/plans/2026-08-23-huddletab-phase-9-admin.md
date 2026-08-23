# HuddleTab Phase 9 Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在同一套 PWA 内交付 System Admin 的用户、注册策略、SMTP、Storage、Backup、Restore 与 System Information 管理能力。

**Architecture:** `/api/admin/*` 先验证 Session 与平台角色，绝不因此读取私人活动。高风险用户变更、备份和恢复由 Service/Transaction 强制不变量；备份归档只包含 PostgreSQL Dump、Uploads 和 Manifest，恢复期间 Maintenance Mode 阻止业务写入。

**Tech Stack:** Next.js App Router, TypeScript, Drizzle ORM, PostgreSQL 18, Node child_process, tar, Nodemailer, Vitest, Testcontainers, Playwright.

---

## File responsibility map

```text
src/server/services/system-admin-service.ts        复用 Phase 2 的 LAST_ACTIVE_ADMIN 事务并补齐启用/授权
src/server/permissions/require-system-admin.ts      平台管理员 API 守卫，不授予活动权限
src/server/services/system-settings-service.ts      注册策略与 SMTP 配置
src/server/services/system-information-service.ts   版本、数据库与本地存储统计
src/server/maintenance/maintenance-mode.ts          恢复期间写入闸门
src/server/backup/backup-service.ts                 备份创建、校验、下载和删除
src/server/backup/restore-service.ts                安全解包、恢复、迁移兼容检查
src/app/api/admin/**                                管理 JSON/文件 API
src/app/admin/**                                    同一 PWA 内的移动优先管理界面
src/server/db/schema/backup-records.ts              备份元数据
```

### Task 1: Enforce System Admin user-management invariants

**Files:**
- Create: `src/server/permissions/require-system-admin.ts`
- Modify: `src/server/services/system-admin-service.ts`
- Create: `src/app/api/admin/users/[userId]/status/route.ts`
- Create: `src/app/api/admin/users/[userId]/system-admin/route.ts`
- Test: `tests/integration/phase-9/admin-user-service.test.ts`
- Test: `tests/api/admin-users.test.ts`

- [ ] **Step 1: Write failing transaction tests**

```ts
it.each(["DISABLE", "REVOKE_ADMIN", "DELETE"])("rejects %s on the last login-capable admin", async (operation) => {
  const admin = await ctx.seedOnlyLoginCapableSystemAdmin();
  await expect(service.apply({ actorUserId: admin.id, targetUserId: admin.id, operation }))
    .rejects.toMatchObject({ status: 409, code: "LAST_ACTIVE_ADMIN" });
  expect(await ctx.isLoginCapableAdmin(admin.id)).toBe(true);
});

it("revokes sessions when a user is disabled", async () => {
  const { actor, target } = await ctx.seedTwoAdminsAndUser();
  await service.apply({ actorUserId: actor.id, targetUserId: target.id, operation: "DISABLE" });
  expect(await ctx.activeSessionCount(target.id)).toBe(0);
});
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:integration -- tests/integration/phase-9/admin-user-service.test.ts`

Expected: FAIL because the admin routes and the Phase 9 enable/grant methods do not exist.

- [ ] **Step 3: Extend the existing Phase 2 SystemAdminService and add routes**

Add these methods inside the existing `SystemAdminService`; do not create a second service or duplicate `assertAdminRemains()`:

```ts
async enableUser(userId: string): Promise<void> {
  await this.sql`update user_profiles set disabled_at = null, updated_at = now() where user_id = ${userId}`;
}

async grantSystemAdmin(userId: string, grantedByUserId: string): Promise<void> {
  await this.sql.begin(async (tx) => {
    await tx`insert into system_roles (user_id, role, granted_by_user_id, granted_at)
      values (${userId}, 'system_admin', ${grantedByUserId}, now())
      on conflict (user_id, role) do nothing`;
  });
}
```

`requireSystemAdmin()` checks Session then platform role only and never creates or impersonates ActivityMember. The status and role Route Handlers dispatch to the existing `disableUser()`, `revokeSystemAdmin()`, `deleteUser()` plus the two methods above. All routes preserve `409 LAST_ACTIVE_ADMIN`; disabled users receive `403 ACCOUNT_DISABLED` with Chinese copy.
- [ ] **Step 4: Verify API and transaction behavior**

Run: `npm run test:integration -- tests/integration/phase-9/admin-user-service.test.ts && npm run test:unit -- tests/api/admin-users.test.ts`

Expected: PASS, including a concurrent two-admin revoke test where one transaction succeeds and the other returns `LAST_ACTIVE_ADMIN`.

- [ ] **Step 5: Commit**

```bash
git add src/server/permissions/require-system-admin.ts src/server/services/system-admin-service.ts src/app/api/admin/users tests/integration/phase-9/admin-user-service.test.ts tests/api/admin-users.test.ts
git commit -m "feat: enforce system admin invariants"
```

### Task 2: Manage registration policy and optional SMTP

**Files:**
- Create: `src/server/services/system-settings-service.ts`
- Create: `src/app/api/admin/registration-policy/route.ts`
- Create: `src/app/api/admin/smtp/route.ts`
- Create: `src/app/api/admin/smtp/test/route.ts`
- Create: `src/app/admin/settings/page.tsx`
- Modify: `package.json`, `package-lock.json`
- Test: `tests/integration/phase-9/system-settings.test.ts`

- [ ] **Step 1: Install SMTP client and write failing tests**

Run: `npm install nodemailer && npm install --save-dev @types/nodemailer`

```ts
it("defaults registration to INVITE_ONLY", async () => {
  expect(await service.getRegistrationPolicy()).toBe("INVITE_ONLY");
});

it("redacts SMTP password and does not block login when SMTP is absent", async () => {
  await service.saveSmtp({ enabled: false, host: "", port: 587, secure: false, username: "", password: "" });
  expect(await service.getSmtpView()).toEqual({ enabled: false, configured: false });
  await expect(ctx.loginExistingUser()).resolves.toBeDefined();
});
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:integration -- tests/integration/phase-9/system-settings.test.ts`

Expected: FAIL because settings service/API are absent.

- [ ] **Step 3: Implement validated settings**

```ts
export const registrationPolicySchema = z.enum(["INVITE_ONLY", "OPEN"]);
export const smtpSchema = z.object({
  enabled: z.boolean(), host: z.string().trim().max(255), port: z.number().int().min(1).max(65535),
  secure: z.boolean(), username: z.string().max(255), password: z.string().max(1024),
}).superRefine((v, ctx) => {
  if (v.enabled && (!v.host || !v.username || !v.password))
    ctx.addIssue({ code: "custom", message: "启用 SMTP 时必须填写服务器、用户名和密码。" });
});

export class SystemSettingsService {
  setRegistrationPolicy(policy: "INVITE_ONLY" | "OPEN", actorUserId: string) {
    return this.repository.upsert("registration_policy", policy, actorUserId);
  }
  async saveSmtp(input: SmtpInput, actorUserId: string) {
    const encryptedPassword = input.password ? this.secrets.encrypt(input.password) : null;
    await this.repository.saveSmtp({ ...input, password: encryptedPassword }, actorUserId);
  }
  async getSmtpView() {
    const row = await this.repository.getSmtp();
    return { enabled: row?.enabled ?? false, configured: Boolean(row?.host && row?.password) };
  }
  constructor(private readonly repository: SystemSettingsRepository, private readonly secrets: SettingsSecretBox) {}
}
```

Derive `SettingsSecretBox` with HKDF from `BETTER_AUTH_SECRET` and AES-256-GCM; never return or log the decrypted password. `POST /api/admin/smtp/test` sends one test message only when a real recipient is explicitly supplied; failure returns `422 SMTP_TEST_FAILED` with Chinese explanation and redacted logs. SMTP absence must not affect registration, login or core accounting.

- [ ] **Step 4: Verify pass**

Run: `npm run test:integration -- tests/integration/phase-9/system-settings.test.ts && npm run typecheck`

Expected: PASS; API JSON contains no SMTP password or Synthetic Email.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/server/services/system-settings-service.ts src/app/api/admin/registration-policy src/app/api/admin/smtp src/app/admin/settings tests/integration/phase-9/system-settings.test.ts
git commit -m "feat: add registration and smtp settings"
```

### Task 3: Report storage and system information

**Files:**
- Create: `src/server/services/system-information-service.ts`
- Create: `src/app/api/admin/storage/route.ts`
- Create: `src/app/api/admin/system-information/route.ts`
- Create: `src/app/admin/system/page.tsx`
- Test: `tests/unit/admin/system-information-service.test.ts`
- Test: `tests/api/admin-system-information.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
it("reports database, uploads, backups and total bytes", async () => {
  const service = new SystemInformationService({ databaseBytes: async () => 100n,
    directoryBytes: async (name) => name === "uploads" ? 20n : 5n, databaseVersion: async () => "PostgreSQL 18.0" });
  expect(await service.storage()).toEqual({ databaseBytes: "100", uploadsBytes: "20", backupsBytes: "5", totalBytes: "125" });
});

it("does not disclose system paths to non-admin", async () => {
  const response = await api.get("/api/admin/system-information", member.session);
  expect(response.status).toBe(403);
});
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:unit -- tests/unit/admin/system-information-service.test.ts tests/api/admin-system-information.test.ts`

Expected: FAIL because service/routes do not exist.

- [ ] **Step 3: Implement exact reporting**

```ts
export class SystemInformationService {
  async storage() {
    const [databaseBytes, uploadsBytes, backupsBytes] = await Promise.all([
      this.probe.databaseBytes(), this.probe.directoryBytes("uploads"), this.probe.directoryBytes("backups"),
    ]);
    return { databaseBytes: String(databaseBytes), uploadsBytes: String(uploadsBytes),
      backupsBytes: String(backupsBytes), totalBytes: String(databaseBytes + uploadsBytes + backupsBytes) };
  }
  async information() {
    return { appVersion: process.env.APP_VERSION ?? "dev", pwaVersion: process.env.PWA_VERSION ?? "dev",
      databaseVersion: await this.probe.databaseVersion(), dataDirectory: process.env.DATA_DIR ?? "/data" };
  }
  constructor(private readonly probe: SystemProbe) {}
}
```

Directory traversal uses `lstat`, ignores symlinks, and counts only `/data/uploads` and `/data/backups`. PostgreSQL size uses `pg_database_size(current_database())`. UI uses cards/lists rather than a desktop-only table and formats API bigint strings client-side.

- [ ] **Step 4: Verify pass**

Run: `npm run test:unit -- tests/unit/admin/system-information-service.test.ts tests/api/admin-system-information.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/system-information-service.ts src/app/api/admin/storage src/app/api/admin/system-information src/app/admin/system tests/unit/admin tests/api/admin-system-information.test.ts
git commit -m "feat: add storage and system information"
```

### Task 4: Create, download, delete and restore complete backups

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `src/server/db/schema/backup-records.ts`
- Create: `src/server/maintenance/maintenance-mode.ts`
- Create: `src/server/backup/backup-service.ts`
- Create: `src/server/backup/restore-service.ts`
- Create: `src/app/api/admin/backups/route.ts`
- Create: `src/app/api/admin/backups/[backupId]/route.ts`
- Create: `src/app/api/admin/backups/[backupId]/restore/route.ts`
- Create: `src/app/admin/backups/page.tsx`
- Test: `tests/integration/phase-9/backup-restore.test.ts`
- Test: `tests/e2e/admin-backup-restore.spec.ts`

- [ ] **Step 1: Install archive library and write failing tests**

Run: `npm install tar`

```ts
it("creates a backup containing only manifest, database dump and uploads", async () => {
  const record = await backupService.create(admin.id);
  expect(await ctx.archiveEntries(record.path)).toEqual([
    "manifest.json", "database.dump", "uploads/receipt.webp",
  ]);
});

it("blocks business writes while restore owns maintenance mode", async () => {
  await maintenance.enter("RESTORE", admin.id);
  const response = await api.post("/api/activities", validActivity, member.session);
  expect(response.status).toBe(503);
  expect((await response.json()).error.code).toBe("MAINTENANCE_MODE");
});
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:integration -- tests/integration/phase-9/backup-restore.test.ts`

Expected: FAIL because backup/maintenance services do not exist.

- [ ] **Step 3: Implement backup and restore boundary**

```ts
export class BackupService {
  /** 备份边界固定为数据库、Uploads 和 Manifest；不得递归包含 Backups 自身。 */
  async create(actorUserId: string) {
    return this.lock.runExclusive("backup", async () => {
      const work = await mkdtemp(join(this.backupsRoot, ".create-"));
      try {
        await this.commands.pgDump(join(work, "database.dump"));
        await cp(this.uploadsRoot, join(work, "uploads"), { recursive: true });
        await writeFile(join(work, "manifest.json"), JSON.stringify(await this.manifest.create()));
        const finalPath = join(this.backupsRoot, `backup_${Date.now()}.tar.gz`);
        await tar.create({ gzip: true, cwd: work, file: finalPath }, ["manifest.json", "database.dump", "uploads"]);
        return await this.repository.recordReady(actorUserId, finalPath);
      } catch (error) {
        console.error("备份创建失败 [BACKUP_CREATE_FAILED]", redactError(error)); throw error;
      } finally { await rm(work, { recursive: true, force: true }); }
    });
  }
}
```

```ts
export class RestoreService {
  /** 恢复是高风险串行操作：先校验归档，再进入 Maintenance Mode，失败保持可诊断状态。 */
  async restore(backupId: string, actorUserId: string) {
    const record = await this.repository.requireReady(backupId);
    await this.archive.validateEntries(record.path, ["manifest.json", "database.dump", "uploads/"]);
    await this.maintenance.enter("RESTORE", actorUserId);
    try {
      await this.commands.pgRestore(record.path);
      await this.files.replaceUploadsFromArchive(record.path);
      await this.commands.runMigrations();
      await this.commands.runSmokeCheck();
      await this.maintenance.leave();
    } catch (error) {
      console.error("恢复失败，系统仍处于维护模式 [RESTORE_FAILED]", redactError(error));
      throw new AppError(500, "RESTORE_FAILED", "恢复失败，系统保持维护模式，请管理员查看日志并重试。");
    }
  }
}
```

Archive validation rejects absolute paths, `..`, symlinks and any entry outside the three roots. Download is System Admin only and uses generated filename. Delete removes only a resolved path inside `/data/backups`. Create/restore require explicit confirmation in UI. Restore and Phase 8 upload/cleanup share the maintenance gate. `backup_records` stores status, size, checksum, creator and timestamps; never archive bytes.

- [ ] **Step 4: Run Phase 9 gate**

Run: `npm run format:check && npm run lint && npm run typecheck && npm run test:unit && npm run test:integration && npm run test:e2e -- tests/e2e/admin-backup-restore.spec.ts && npm run build`

Expected: PASS; restored Smoke Test can log in, read one seeded activity, and fetch its authorized attachment.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/server/db/schema src/server/maintenance src/server/backup src/app/api/admin/backups src/app/admin/backups tests/integration/phase-9 tests/e2e/admin-backup-restore.spec.ts
git commit -m "feat: add complete backup and restore"
```

## Phase 9 acceptance boundary

- System Admin 只获得平台管理能力，不自动获得私人活动访问权。
- `LAST_ACTIVE_ADMIN` 在 Service/Transaction 层锁定后重查并返回 `409`，UI 禁用不是安全边界。
- 默认注册策略是 `INVITE_ONLY`；SMTP 可选且密码不回显、不进日志，未配置不影响核心功能。
- Storage 显示数据库、附件、备份和总占用；System Information 显示应用、PWA、数据库版本与数据目录。
- 完整备份严格为 `manifest.json + database.dump + uploads/`；Backups 目录不自包含。
- Restore 期间业务写入、附件上传和清理返回 `503 MAINTENANCE_MODE`，完成 Migration/兼容检查/Smoke 后才退出维护模式。
