# Task 3 Cross-Layer Verification Report

Date: 2026-09-01

## Result

Status: DONE_WITH_FIX

One product regression was found and fixed. Anonymous `GET /api/auth/session` returned the expected 401, but the global client interceptor broadcast it as an expired authenticated session. `AppProviders` cleared the active query client, so `ProtectedRoute` kept returning the pending state instead of reaching `/login`. The fix excludes this bootstrap/session-read endpoint from the expired-session broadcast. The related share route is now protected in the real application.

## Commands And Results

Secrets below were read only from `huddletab-rust-dev-postgres-6831` through WSL and were never written to source, this report, visual artifacts, or command output. `<container-derived-url>` represents the in-memory connection string assembled from that disposable container's environment.

1. Initial repository state:

   ```text
   git log -3 --oneline
   748eb9d fix: wait for settlement card image decoding
   2623985 feat: add settlement summary sharing UI
   22d9dd8 fix: format sharing csv timestamps in deployment timezone
   ```

   The pre-existing untracked `.cargo-target-verify-task1/` was left untouched.

2. Focused frontend tests before the regression fix:

   ```text
   cd frontend
   npx vitest run src/features/sharing src/app/router.test.tsx src/features/accounting/api.test.tsx src/features/accounting/pages-ui.test.tsx src/features/accounting/pages.test.ts src/features/activities/api.test.ts src/features/activities/pages.test.tsx
   exit 0: 10 files, 52 tests passed
   npm run typecheck
   exit 0
   npm run build
   exit 0: 1,655 modules transformed; PWA precache 10 entries
   ```

3. PostgreSQL sharing integration test:

   ```text
   TEST_DATABASE_URL=<container-derived-url> CARGO_TARGET_DIR=server/.cargo-target-verify-task3 cargo test --test sharing_api -- --ignored
   ```

   First attempt reached the migration layer and failed: `migration 202608310001 was previously applied but has been modified`. `git diff 22d9dd8..HEAD -- server/migrations` was empty, so this was stale disposable-container migration state, not a task change. The WSL command below cleared only the explicitly supplied disposable database's `public` schema, then the identical test passed:

   ```text
   docker exec huddletab-rust-dev-postgres-6831 ... psql ... "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
   exit 0
   cargo test --test sharing_api -- --ignored
   exit 0: 1 passed, 0 failed, 0 ignored, 2 filtered
   ```

4. Rust and contract checks:

   ```text
   cargo fmt --check
   exit 0
   CARGO_TARGET_DIR=server/.cargo-target-verify-task3-clippy cargo clippy --all-targets --all-features -- -D warnings
   exit 0
   CARGO_TARGET_DIR=server/.cargo-target-verify-task3-tests cargo test --test sharing_api --test openapi
   exit 0: openapi 3 passed; sharing_api 2 passed, 1 ignored
   CARGO_TARGET_DIR=server/.cargo-target-verify-task3-openapi cargo run -- openapi --output server/.task3-openapi.json
   exit 0: SHA-256 matched contracts/openapi.json
   cd frontend && npm run api:generate && git diff --exit-code -- src/api/generated/openapi.ts
   exit 0: generated client had no drift
   ```

5. Protected-route diagnosis and RED/GREEN evidence:

   - Real Chromium diagnostic at `http://127.0.0.1:5661/share-summary/not-a-real-activity` loaded document/CSS/JS with 200 and `/api/auth/session` with 401; no request failures or page errors; after 5 seconds the body was still `正在确认登录状态…`.
   - With one diagnostic-only `addInitScript` suppressing `huddletab:auth-expired`, the same fresh context reached `/login` within 5 seconds. This isolated the event/query-client-clear loop.
   - RED command:

     ```text
     cd frontend && npx vitest run src/api/client.test.ts src/app/router.test.tsx
     exit 1: `匿名读取会话返回 401 时不重置会话查询` failed because the event listener was called once; router tests passed.
     ```

   - GREEN command after the one-line interceptor exclusion:

     ```text
     cd frontend && npx vitest run src/api/client.test.ts src/app/router.test.tsx
     exit 0: 2 files, 8 tests passed
     ```

   - Final affected frontend verification:

     ```text
     npx vitest run src/api/client.test.ts src/features/sharing src/app/router.test.tsx src/features/accounting/api.test.tsx src/features/accounting/pages-ui.test.tsx src/features/accounting/pages.test.ts src/features/activities/api.test.ts src/features/activities/pages.test.tsx
     exit 0: 11 files, 56 tests passed
     npm run typecheck && npm run build
     exit 0: typecheck passed; 1,655 modules transformed; PWA precache 10 entries
     ```

## Browser Verification

The latest Rust binary served the freshly built `frontend/dist` at `127.0.0.1:5661` with `DATABASE_URL=<container-derived-url>`, a task-owned temporary `DATA_DIR`, and an in-memory password passed to `bootstrap-user --password-stdin`. The existing service at port 5660 was not stopped or replaced. Chromium created a real temporary account and activity, used the production API, and the runner stopped the 5661 process afterward.

| Check | Evidence |
| --- | --- |
| Protected share route | Fresh unauthenticated context redirected to `/login` within 5 seconds after the fix. |
| Settlement entry | Real settlement tab exposed `生成分享摘要`. |
| Activity management CSV | Real Overlay exposed `数据导出` and `导出 CSV`. |
| Activity navigation | Exactly `['流水','结算']`. |
| Standalone summary | No `.workspace-header`, `.product-bottom-nav`, or `.update-prompt` in either viewport. |
| Desktop 1440x1000 | `scrollWidth=1440`, `viewportWidth=1440`; preview/export card widths `800/800`. |
| Mobile 390x844 | `scrollWidth=390`, `viewportWidth=390`; preview/export card widths `358/800`; no horizontal overflow. |
| CSV | Server download `activity-export.csv`, 146 bytes, BOM `[239,187,191]`, exact Chinese header recorded below. |
| PNG | Browser click downloaded `huddletab-settlement-summary.png`, 1,821,886 bytes, PNG IHDR width `1600`. DOM export target text contained no `下载 PNG`, `返回结算`, or `流水`; visual inspection also confirmed the image contains only the card. |

CSV header:

```text
消费时间,用途,分类,原始金额,原始币种,汇率,主币种金额,付款人,参与成员,分摊方式,创建人,创建时间,备注
```

Visual artifacts are intentionally uncommitted at `C:\Users\林樾\.codex\visualizations\2026\09\01\01a05aaa-8d7f-75b3-9ced-1653555239e8`:

- `desktop-summary.png`
- `mobile-summary.png`
- `huddletab-settlement-summary.png`
- `activity-export.csv`
- `browser-metadata.json`
- `route-protection-diagnostic.json` and `route-protection-hypothesis.json` (root-cause evidence)

## Cleanup And Changed Files

- Cleared the disposable database schema after verification, removing the temporary user and activity.
- Stopped the task-owned 5661 server.
- Removed task-owned browser scripts, logs, data directory, and all `.cargo-target-verify-task3*` directories.
- Retained the specified visualization artifacts only; they are outside the repository and are not committed.
- Product/test files changed by this task:
  - `frontend/src/api/client.ts`
  - `frontend/src/api/client.test.ts`
  - `frontend/src/app/router.test.tsx`

Concern: WSL lacked a Rust toolchain, so Docker and PostgreSQL operations ran through WSL as required while Rust compilation/tests ran from the Windows toolchain using task-specific targets. No functional verification was skipped.
