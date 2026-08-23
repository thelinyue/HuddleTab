# HuddleTab Phase 10 PWA and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付可安装、受控更新的 PWA 与可验证的两服务生产发布流程，固定应用容器端口为 5660。

**Architecture:** Manifest 与 Serwist 只负责 App Shell/静态资源；业务 Snapshot、Mutation 和附件同步继续由前台 Phase 7 协调器负责。生产 Compose 始终只有 `app + postgres`，App 启动顺序为 Migration、初始化检查、监听 `0.0.0.0:5660`；HTTPS 由 Compose 外部反向代理提供。

**Tech Stack:** Next.js App Router, TypeScript, Serwist, idb, Docker multi-stage build, PostgreSQL 18, Playwright, PowerShell/Bash smoke scripts.

---

## File responsibility map

```text
src/app/manifest.ts                              Web App Manifest
public/icons/*                                   生成并提交的 192/512/maskable 图标
src/app/sw.ts                                    Serwist 预缓存与静态运行时缓存
src/pwa/service-worker/update-controller.ts      waiting 检测和受控激活
src/features/pwa/update-banner.tsx               Pending 安全提示与更新按钮
next.config.ts                                   Serwist 构建接入与安全 headers
src/server/bootstrap/container-start.ts          复用 Phase 2 初始化并编排生产启动
docker/entrypoint.sh                             Migration/bootstrap/start 串行入口
Dockerfile                                       Node 24 生产镜像与 pg 工具
compose.yaml                                     仅 app + postgres、5660 与三类持久卷
docs/deployment/https.md                         外部 HTTPS 反向代理
scripts/smoke.mjs                                无状态发布 Smoke
scripts/verify-backup-restore.mjs                备份恢复演练
scripts/verify-upgrade.ps1                       升级/Migration 演练
```

### Task 1: Add installable manifest and generated icons

**Files:**
- Create: `src/app/manifest.ts`
- Create: `scripts/generate-pwa-icons.mjs`
- Create: `public/icons/icon-source.svg`
- Create: `public/icons/icon-192.png`
- Create: `public/icons/icon-512.png`
- Create: `public/icons/icon-maskable-512.png`
- Test: `tests/unit/pwa/manifest.test.ts`

- [ ] **Step 1: Write the failing manifest test**

```ts
import { expect, it } from "vitest";
import manifest from "@/app/manifest";

it("defines an installable HuddleTab manifest", () => {
  const value = manifest();
  expect(value).toMatchObject({ name: "伙记 HuddleTab", short_name: "伙记",
    start_url: "/activities", display: "standalone", theme_color: "#0F766E" });
  expect(value.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ src: "/icons/icon-192.png", sizes: "192x192" }),
    expect.objectContaining({ src: "/icons/icon-maskable-512.png", purpose: "maskable" }),
  ]));
});
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:unit -- tests/unit/pwa/manifest.test.ts`

Expected: FAIL because `src/app/manifest.ts` does not exist.

- [ ] **Step 3: Implement manifest and deterministic icon generation**

```ts
import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return { name: "伙记 HuddleTab", short_name: "伙记", description: "一起花，清楚分。",
    start_url: "/activities", scope: "/", display: "standalone",
    background_color: "#F8FAFC", theme_color: "#0F766E", lang: "zh-CN",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ] };
}
```

`scripts/generate-pwa-icons.mjs` uses already-installed `sharp` to render the committed SVG source to exact PNG sizes; maskable output retains a 20% safe margin. Add `"pwa:icons": "node scripts/generate-pwa-icons.mjs"`, run it, and commit generated binaries so production builds do not depend on mutable design tooling.

- [ ] **Step 4: Verify pass**

Run: `npm run pwa:icons && npm run test:unit -- tests/unit/pwa/manifest.test.ts && npm run build`

Expected: PASS and all three PNG files exist with expected dimensions.

- [ ] **Step 5: Commit**

```bash
git add src/app/manifest.ts scripts/generate-pwa-icons.mjs public/icons package.json package-lock.json tests/unit/pwa/manifest.test.ts
git commit -m "feat: add installable pwa manifest"
```

### Task 2: Add Serwist static caching and controlled updates

**Files:**
- Modify: `package.json`, `package-lock.json`, `next.config.ts`
- Create: `src/app/sw.ts`
- Create: `src/pwa/service-worker/update-controller.ts`
- Create: `src/features/pwa/update-banner.tsx`
- Modify: `src/components/design-system/app-shell.tsx`
- Test: `tests/unit/pwa/update-controller.test.ts`
- Test: `tests/e2e/pwa-update.spec.ts`

- [ ] **Step 1: Install Serwist and write failing tests**

Run: `npm install serwist @serwist/next`

```ts
it("does not activate a waiting worker while foreground queues are pending", async () => {
  const worker = { postMessage: vi.fn() };
  const controller = createUpdateController({ pendingMutationCount: async () => 1,
    pendingAttachmentCount: async () => 0, reload: vi.fn() });
  expect(await controller.requestActivation(worker)).toEqual({ activated: false, reason: "PENDING_SYNC" });
  expect(worker.postMessage).not.toHaveBeenCalled();
});

test("shows sync-first update copy", async ({ page }) => {
  await page.goto("/test/pwa-update?pending=1&waiting=1");
  await expect(page.getByText("有新版本可用，完成同步后更新")).toBeVisible();
  await expect(page.getByRole("button", { name: "立即更新" })).toBeDisabled();
});
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:unit -- tests/unit/pwa/update-controller.test.ts && npm run test:e2e -- tests/e2e/pwa-update.spec.ts`

Expected: FAIL because worker/update modules are absent.

- [ ] **Step 3: Implement narrow Serwist boundary**

```ts
// src/app/sw.ts
import { Serwist, CacheFirst, NetworkFirst, ExpirationPlugin } from "serwist";
declare const self: ServiceWorkerGlobalScope & { __SW_MANIFEST: Array<PrecacheEntry> };
const serwist = new Serwist({ precacheEntries: self.__SW_MANIFEST, skipWaiting: false, clientsClaim: false,
  runtimeCaching: [
    { matcher: ({ request }) => request.mode === "navigate", handler: new NetworkFirst({ cacheName: "app-shell" }) },
    { matcher: ({ url }) => url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/"),
      handler: new CacheFirst({ cacheName: "static-v1", plugins: [new ExpirationPlugin({ maxEntries: 80 })] }) },
  ] });
serwist.addEventListeners();
```

No matcher may cache `/api/`, attachments, auth, activity Snapshot or mutation responses.

```ts
import { mayActivateUpdate } from "@/pwa/service-worker/update-policy";

export function createUpdateController(deps: UpdateDependencies) {
  return { async requestActivation(worker: Pick<ServiceWorker, "postMessage">) {
    const decision = mayActivateUpdate({
      pendingMutations: await deps.pendingMutationCount(),
      pendingAttachments: await deps.pendingAttachmentCount(),
    });
    if (!decision.allowed) return { activated: false as const, reason: "PENDING_SYNC" as const };
    worker.postMessage({ type: "SKIP_WAITING" });
    return { activated: true as const };
  }};
}
```

Configure `@serwist/next` with `swSrc: "src/app/sw.ts"`, `swDest: "public/sw.js"`, disabled in development. `UpdateBanner` listens for a waiting worker, calls Phase 7 queue counters, shows the confirmed Chinese message, and reloads only after `controllerchange`. Business sync remains foreground-owned; do not add Background Sync.

- [ ] **Step 4: Verify pass**

Run: `npm run test:unit -- tests/unit/pwa/update-controller.test.ts && npm run test:e2e -- tests/e2e/pwa-update.spec.ts && npm run build`

Expected: PASS; inspect `public/sw.js` and confirm no `/api/` runtime caching rule.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json next.config.ts src/app/sw.ts src/pwa/service-worker src/features/pwa src/components/design-system/app-shell.tsx tests/unit/pwa tests/e2e/pwa-update.spec.ts
git commit -m "feat: add controlled pwa updates"
```

### Task 3: Harden production startup, Docker and Setup Token logging

**Files:**
- Modify: `src/server/bootstrap/container-start.ts`
- Create: `docker/entrypoint.sh`
- Modify: `Dockerfile`, `compose.yaml`, `.env.example`, `package.json`
- Test: `tests/integration/phase-10/bootstrap.test.ts`
- Test: `tests/e2e/production-compose.spec.ts`

- [ ] **Step 1: Write failing production-start tests**

```ts
it("reuses the Phase 2 setup initializer exactly once before starting Next.js", async () => {
  const initializeSetup = vi.fn().mockResolvedValue(undefined);
  const startNext = vi.fn().mockResolvedValue(undefined);
  await prepareContainerStart({ initializeSetup, startNext });
  expect(initializeSetup).toHaveBeenCalledTimes(1);
  expect(startNext).toHaveBeenCalledTimes(1);
  expect(initializeSetup.mock.invocationCallOrder[0]).toBeLessThan(startNext.mock.invocationCallOrder[0]);
});
```

The production Compose E2E starts an uninitialized database, captures `docker compose logs app`, and asserts that exactly one line contains both `Setup Token` and `容器日志仅应向部署管理员开放`; after setup completion and restart, the token line count must be zero.

- [ ] **Step 2: Verify failure**

Run: `npm run test:integration -- tests/integration/phase-10/bootstrap.test.ts`

Expected: FAIL because `prepareContainerStart()` is not exported and the hardened entrypoint does not exist.

- [ ] **Step 3: Reuse Phase 2 initialization and harden the production entrypoint**

Refactor `src/server/bootstrap/container-start.ts` without duplicating token generation:

```ts
import { initializeSetup } from "./initialize-setup";

interface ContainerStartDependencies {
  initializeSetup(): Promise<void>;
  startNext(): Promise<void>;
}

/**
 * 生产启动只编排迁移后的初始化检查与 Next.js 启动。
 * Setup Token 的生成、Hash 替换和一次性中文日志仍由 Phase 2 initializeSetup() 唯一负责。
 */
export async function prepareContainerStart(deps: ContainerStartDependencies): Promise<void> {
  await deps.initializeSetup();
  await deps.startNext();
}

if (process.env.NODE_ENV === "production") {
  await prepareContainerStart({ initializeSetup, startNext: spawnNextAndWait });
}
```

Create `docker/entrypoint.sh`:

```sh
#!/bin/sh
set -eu
printf '%s\n' '正在执行数据库迁移……'
npm run db:migrate
printf '%s\n' '正在检查首次初始化状态……'
exec npm run start:container
```

The runtime image copies `docker/entrypoint.sh`, marks it executable, and uses it as `ENTRYPOINT`. Compose remains exactly `app` plus `postgres`, maps `5660:5660`, and mounts only PostgreSQL data, uploads, and backups. The Setup Token remains the one explicit sensitive-log exception and deployment documentation states that container logs must be visible only to administrators.

- [ ] **Step 4: Verify pass**

Run: `npm run test:integration -- tests/integration/phase-10/bootstrap.test.ts && npm run test:e2e -- tests/e2e/production-compose.spec.ts && docker compose config --services`

Expected: PASS; services are exactly `app` and `postgres`; uninitialized startup prints one Setup Token warning, initialized restart prints none.

- [ ] **Step 5: Commit**

```bash
git add src/server/bootstrap/container-start.ts docker/entrypoint.sh Dockerfile compose.yaml .env.example package.json tests/integration/phase-10/bootstrap.test.ts tests/e2e/production-compose.spec.ts
git commit -m "chore: harden production startup"
```
### Task 4: Add HTTPS, backup/restore, upgrade and release verification

**Files:**
- Create: `docs/deployment/https.md`
- Create: `docs/deployment/backup-restore.md`
- Create: `docs/deployment/upgrade.md`
- Create: `scripts/smoke.mjs`
- Create: `scripts/verify-backup-restore.mjs`
- Create: `scripts/verify-upgrade.ps1`
- Modify: `package.json`
- Modify: `next.config.ts`
- Test: `tests/e2e/release-smoke.spec.ts`

- [ ] **Step 1: Write failing release tests**

```ts
import { expect, test } from "@playwright/test";

test("production security and PWA endpoints are healthy", async ({ request }) => {
  const health = await request.get("/api/health"); expect(health.status()).toBe(200);
  const manifest = await request.get("/manifest.webmanifest"); expect(manifest.status()).toBe(200);
  const page = await request.get("/");
  expect(page.headers()["x-content-type-options"]).toBe("nosniff");
  expect(page.headers()["content-security-policy"]).toContain("default-src 'self'");
  expect(page.headers()["x-frame-options"]).toBe("DENY");
});
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:e2e -- tests/e2e/release-smoke.spec.ts`

Expected: FAIL because manifest/security headers or release server are incomplete.

- [ ] **Step 3: Implement docs, headers and scripts**

`next.config.ts` adds CSP, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, and a restrictive `Permissions-Policy`. Production Secure cookies trust the configured public HTTPS origin and forwarded protocol; forwarded client addresses are used only through the documented trusted proxy boundary.

`docs/deployment/https.md` provides one complete Caddy example outside the core Compose:

```caddyfile
huddletab.example.com {
  reverse_proxy 127.0.0.1:5660
}
```

It states that public production deployment requires HTTPS, proxy logs/config are administrator-only, and the core Compose must not gain a proxy service.

`scripts/smoke.mjs` checks health, manifest, login page, authenticated activity list, one authorized attachment, and reports Chinese errors with stable step names. `scripts/verify-backup-restore.mjs` seeds a record plus attachment, creates backup, changes data, restores, then verifies the original row/file and `/api/health`. `scripts/verify-upgrade.ps1` takes a backup, records the old image, pulls/builds the new image, starts Compose so migrations run, executes Smoke, and prints the old image rollback command; it never uses `drizzle-kit push`.

Add scripts:

```json
{
  "smoke": "node scripts/smoke.mjs",
  "verify:backup-restore": "node scripts/verify-backup-restore.mjs",
  "verify:upgrade": "powershell -ExecutionPolicy Bypass -File scripts/verify-upgrade.ps1"
}
```

`docs/deployment/backup-restore.md` states the backup boundary (`database.dump`, `uploads/`, `manifest.json`), Maintenance Mode behavior, checksum check and post-restore Smoke. `docs/deployment/upgrade.md` states backup → pull/build → migration → Smoke → retain old image; migration failure means App does not start.

- [ ] **Step 4: Run final release gate**

Run:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
docker compose build
docker compose up -d
npm run smoke
npm run verify:backup-restore
npm run test:e2e
```

Expected: every command PASS; `docker compose config --services` still lists only `postgres` and `app`; App listens on `0.0.0.0:5660`; pending business data survives the PWA update E2E.

- [ ] **Step 5: Commit**

```bash
git add docs/deployment scripts package.json package-lock.json next.config.ts tests/e2e/release-smoke.spec.ts
git commit -m "docs: add production release runbooks"
```

## Phase 10 release boundary

- Manifest 可安装；Serwist 只缓存 App Shell、导航回退和静态资源，不缓存 API/认证/附件/业务响应。
- Pending Mutation 或附件存在时不强制刷新；业务同步仍由前台应用触发，无 Background Sync、WebSocket 或第二同步引擎。
- Production Compose 仅 `app + postgres`，App 固定监听 `0.0.0.0:5660` 并默认映射 `5660:5660`。
- 首次未初始化启动自动生成 Setup Token，数据库只存 Hash，明文只在该次容器启动日志输出一次，并明确提醒日志仅管理员可见。
- 正式升级只执行已提交 SQL Migration；失败时 App 不启动，禁止 `drizzle-kit push`。
- PostgreSQL、Uploads、Backups 均为持久卷；完整备份恢复和 Smoke 演练通过后才可发布。
- HTTPS 由外部可信反向代理提供，不向核心 Compose 增加第三个服务。
