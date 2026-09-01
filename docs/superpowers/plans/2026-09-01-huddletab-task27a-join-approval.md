# HuddleTab Task 27A Join Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Activity 级加入审批、Owner 决策、申请人状态和两类最小站内通知，并保持邀请、成员、Audit、revision 与通知在 PostgreSQL 事务内一致。

**Architecture:** 在现有 collaboration 边界扩展加入分支与审批事务，新增独立 notification 读取边界；Activity `inviteMode` 继续走现有 Activity 更新与 Snapshot read model。PostgreSQL 约束负责 Pending 唯一性，Repository 负责固定锁顺序与副作用原子性，HTTP 和 React 只映射 application 合同。

**Tech Stack:** Rust、Axum、SQLx、PostgreSQL、utoipa/OpenAPI、React、TypeScript、TanStack Query、Vitest、Testing Library。

**Spec:** `docs/superpowers/specs/2026-09-01-huddletab-task27a-join-approval-design.md`

## Global Constraints

- 只实现 Task 27A；不进入 Guest Binding、Attachment、Rate Provider、其他通知事件或 Task 28。
- 新 Activity 默认 `DIRECT_JOIN`；邀请不复制 `inviteMode`，join 时读取 Activity 当前值。
- 审批仅限 Owner；不新增 ADMIN 或新的权限层。
- Pending 不消耗邀请次数；approve 成功时才原子消耗一次。
- 明文邀请 token、Session、CSRF 和临时凭据不得进入日志、文档或提交。
- PostgreSQL/Docker 验证只使用 WSL 可丢弃环境，数据库测试强制 `--test-threads=1`。
- 不新增 hash、baseline、contract freeze、触发器、版本表或分布式锁。
- 不创建 `v0.0.3` tag，不发布 GHCR 镜像，不宣称达到正式发布状态。

---

### Task 1: Join Approval Schema And Domain Rules

**Files:**
- Create: `server/migrations/202609010004_join_approval.sql`
- Create: `server/src/domain/join_request.rs`
- Modify: `server/src/domain/activity.rs`
- Modify: `server/src/domain/mod.rs`
- Test: `server/tests/migrations.rs`
- Test: `server/tests/schema_constraints.rs`
- Test: `server/tests/domain_activity.rs`
- Create: `server/tests/domain_join_request.rs`

**Interfaces:**
- Produces: `InviteMode::{DirectJoin, RequireApproval}`, `InviteMode::parse(&str)`, `InviteMode::as_str()`.
- Produces: `JoinRequestStatus::{Pending, Approved, Rejected}`, `JoinDecision::{Approve, Reject}`, and `JoinRequestStatus::decide(JoinDecision)` returning an idempotent result or opposite-decision conflict.
- Produces: PostgreSQL `activities.invite_mode`, `activity_join_requests`, `notifications`, and partial unique index on Pending `(activity_id, applicant_user_id)`.

- [ ] **Step 1: Write failing domain and migration tests**

Add literal behavior assertions:

```rust
#[test]
fn invite_mode_accepts_only_the_two_frozen_values() {
    assert_eq!(InviteMode::parse("DIRECT_JOIN"), Some(InviteMode::DirectJoin));
    assert_eq!(InviteMode::parse("REQUIRE_APPROVAL"), Some(InviteMode::RequireApproval));
    assert_eq!(InviteMode::parse("PER_INVITE"), None);
}

#[test]
fn repeated_same_decision_is_idempotent_but_opposite_decision_conflicts() {
    assert_eq!(
        JoinRequestStatus::Approved.decide(JoinDecision::Approve),
        Ok(DecisionEffect::Replay),
    );
    assert_eq!(
        JoinRequestStatus::Approved.decide(JoinDecision::Reject),
        Err(JoinRequestTransitionError::Closed),
    );
}
```

Extend migration tests to assert the new migration applies on a fresh database, new activities default to `DIRECT_JOIN`, invalid enum-like text is rejected, and two concurrent Pending rows for one Activity/User violate the partial unique index while a later REJECTED row allows a new Pending.

- [ ] **Step 2: Run RED tests**

Run:

```powershell
cargo test --manifest-path server/Cargo.toml --test domain_activity --test domain_join_request
cargo test --manifest-path server/Cargo.toml --test migrations --test schema_constraints -- --ignored --test-threads=1
```

Expected: domain test fails because the types do not exist; PostgreSQL tests fail because migration `004` and its constraints do not exist.

- [ ] **Step 3: Implement minimal schema and domain types**

Use text columns with explicit checks rather than adding PostgreSQL enum migrations:

```sql
ALTER TABLE activities
ADD COLUMN invite_mode text NOT NULL DEFAULT 'DIRECT_JOIN'
CHECK (invite_mode IN ('DIRECT_JOIN', 'REQUIRE_APPROVAL'));

CREATE TABLE activity_join_requests (
    id uuid PRIMARY KEY,
    activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    invitation_id uuid NOT NULL,
    applicant_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    decided_by_member_id uuid,
    decided_at timestamptz,
    created_at timestamptz NOT NULL,
    CHECK (
        (status = 'PENDING' AND decided_by_member_id IS NULL AND decided_at IS NULL)
        OR
        (status <> 'PENDING' AND decided_by_member_id IS NOT NULL AND decided_at IS NOT NULL)
    ),
    FOREIGN KEY (activity_id, invitation_id)
        REFERENCES activity_invites(activity_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (activity_id, decided_by_member_id)
        REFERENCES activity_members(activity_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX activity_join_requests_one_pending_per_user
ON activity_join_requests(activity_id, applicant_user_id)
WHERE status = 'PENDING';

CREATE TABLE notifications (
    id uuid PRIMARY KEY,
    recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type text NOT NULL CHECK (
        type IN ('JOIN_APPROVAL_REQUESTED', 'JOIN_APPROVAL_RESOLVED')
    ),
    target_type text NOT NULL CHECK (target_type = 'ACTIVITY'),
    target_id uuid NOT NULL,
    activity_id uuid REFERENCES activities(id) ON DELETE CASCADE,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(payload) = 'object'),
    read_at timestamptz,
    created_at timestamptz NOT NULL
);
```

Before the composite foreign keys, add unique constraints for `activity_invites(activity_id, id)` and `activity_members(activity_id, id)`. This prevents a JoinRequest from associating an Invitation or deciding member from another Activity.

- [ ] **Step 4: Run GREEN tests**

Run the commands from Step 2. Expected: all new domain and disposable PostgreSQL constraint tests pass.

- [ ] **Step 5: Commit**

```powershell
git add server/migrations/202609010004_join_approval.sql server/src/domain server/tests/migrations.rs server/tests/schema_constraints.rs server/tests/domain_activity.rs server/tests/domain_join_request.rs
git commit -m "feat: add join approval schema and rules"
```

### Task 2: Activity Invite Mode And Snapshot Revision

**Files:**
- Modify: `server/src/application/activity.rs`
- Modify: `server/src/infrastructure/activity_repository.rs`
- Modify: `server/src/infrastructure/snapshot_repository.rs`
- Modify: `server/src/http/activity.rs`
- Modify: `server/src/http/snapshot.rs`
- Test: `server/tests/activity_api.rs`
- Test: `server/tests/snapshot_api.rs`

**Interfaces:**
- Extends: `CreateActivityInput`, `NewActivity`, `ActivityView`, `ActivityUpdate`, and `UpdateActivityInput` with `invite_mode`.
- Extends: `CreateActivityRequest`, `UpdateActivityRequest`, and `ActivityData` with camel-case `inviteMode`.
- Guarantees: omitted create value defaults to `DIRECT_JOIN`; update accepts only frozen values; no-op mode update does not advance version/revision/Audit.

- [ ] **Step 1: Write failing API and Snapshot tests**

Add focused cases that create an Activity and assert `inviteMode == "DIRECT_JOIN"`; update it using its current version and assert `REQUIRE_APPROVAL`, version +1, revision +1, one `ACTIVITY_UPDATED` Audit; repeat the same PUT and assert version/revision/Audit unchanged. Fetch Snapshot before and after the first change and assert Activity data and weak ETag both change.

- [ ] **Step 2: Run RED tests**

```powershell
cargo test --manifest-path server/Cargo.toml --test activity_api invite_mode_ -- --ignored --test-threads=1
cargo test --manifest-path server/Cargo.toml --test snapshot_api invite_mode_ -- --ignored --test-threads=1
```

Expected: response fields or update input are missing.

- [ ] **Step 3: Thread invite mode through existing Activity paths**

Parse with the domain type in application code, include `invite_mode` in all Activity repository selects/inserts/updates, and include it in `ActivityData` so Snapshot automatically uses the same DTO mapping. Treat `inviteMode` as Owner-editable even when accounting records exist; keep lifecycle and base-currency locks unchanged.

- [ ] **Step 4: Run GREEN and regression tests**

```powershell
cargo test --manifest-path server/Cargo.toml --test activity_api invite_mode_ -- --ignored --test-threads=1
cargo test --manifest-path server/Cargo.toml --test snapshot_api invite_mode_ -- --ignored --test-threads=1
cargo test --manifest-path server/Cargo.toml --test activity_api -- --ignored --test-threads=1
cargo test --manifest-path server/Cargo.toml --test snapshot_api -- --ignored --test-threads=1
```

Expected: focused and existing Activity/Snapshot integration tests pass.

- [ ] **Step 5: Commit**

```powershell
git add server/src/application/activity.rs server/src/infrastructure/activity_repository.rs server/src/infrastructure/snapshot_repository.rs server/src/http/activity.rs server/src/http/snapshot.rs server/tests/activity_api.rs server/tests/snapshot_api.rs
git commit -m "feat: configure activity join approval mode"
```

### Task 3: Pending Join Request Creation

**Files:**
- Modify: `server/src/application/collaboration.rs`
- Modify: `server/src/infrastructure/collaboration_repository.rs`
- Modify: `server/src/http/collaboration.rs`
- Test: `server/tests/collaboration_api.rs`

**Interfaces:**
- Extends: `JoinStatus` with `PendingApproval`.
- Extends: `JoinedInvitation` / `JoinInvitationData` with nullable `request_id` and nullable `member_id` appropriate to status.
- Produces: repository transaction that returns an existing Pending request on unique-conflict replay.

- [ ] **Step 1: Write failing join branch tests**

Add real PostgreSQL API cases for:

```text
DIRECT_JOIN -> JOINED with memberId
REQUIRE_APPROVAL -> PENDING_APPROVAL with requestId and no member
same user repeats -> same requestId, one JoinRequest, one owner notification, one Audit, one revision
two concurrent repeats -> same requestId and the same single set of side effects
ENDED/ARCHIVED/deleted -> no JoinRequest
revoked/expired/exhausted/direct-username mismatch -> no JoinRequest
```

The concurrent test must use two independent HTTP requests and hand-derived database counts.

- [ ] **Step 2: Run RED test**

```powershell
cargo test --manifest-path server/Cargo.toml --test collaboration_api join_request_ -- --ignored --test-threads=1
```

Expected: REQUIRE_APPROVAL still creates a member or the response cannot represent Pending.

- [ ] **Step 3: Implement the minimal transactional branch**

Lock Invitation and Activity before deciding the branch. For `REQUIRE_APPROVAL`, check membership first, then select existing Pending; otherwise insert the request. On partial-unique conflict, roll back the failed statement safely and fetch the winner using a nested savepoint or a single `INSERT ... ON CONFLICT ...` shape supported by the partial index. Only the winning insert writes owner notification, Audit, and revision.

Return:

```rust
JoinedInvitation {
    status: JoinStatus::PendingApproval,
    activity_id,
    member_id: None,
    request_id: Some(request_id),
    revision,
}
```

Keep token revalidation and redacted Debug behavior unchanged.

- [ ] **Step 4: Run GREEN and collaboration regression**

```powershell
cargo test --manifest-path server/Cargo.toml --test collaboration_api join_request_ -- --ignored --test-threads=1
cargo test --manifest-path server/Cargo.toml --test collaboration_api -- --ignored --test-threads=1
```

Expected: new branch and existing guest/invitation/direct-join tests pass.

- [ ] **Step 5: Commit**

```powershell
git add server/src/application/collaboration.rs server/src/infrastructure/collaboration_repository.rs server/src/http/collaboration.rs server/tests/collaboration_api.rs
git commit -m "feat: create pending join requests"
```

### Task 4: Owner Decisions And Applicant Status

**Files:**
- Modify: `server/src/application/collaboration.rs`
- Modify: `server/src/infrastructure/collaboration_repository.rs`
- Modify: `server/src/http/collaboration.rs`
- Modify: `server/src/http/router.rs`
- Test: `server/tests/collaboration_api.rs`

**Interfaces:**
- Produces: `list_join_requests(activity_id, actor_user_id)` for Owner Pending rows.
- Produces: `get_join_request(request_id, applicant_user_id)` restricted to the applicant.
- Produces: `decide_join_request(activity_id, request_id, actor_user_id, JoinDecision)` with replay/closed semantics.
- Adds routes: `GET /api/activities/{activity_id}/join-requests`, `POST /api/activities/{activity_id}/join-requests/{request_id}`, `GET /api/join-requests/{request_id}`.

- [ ] **Step 1: Write failing authorization, decision, and concurrency tests**

Cover Owner list, ordinary-member forbidden list/decision, applicant self-read, other-user not found, approve, reject, repeated same decision replay, opposite decision `409 JOIN_REQUEST_CLOSED`, concurrent approve, invitation invalidation, Activity lifecycle, and pre-existing member conflict.

For concurrent approve assert literal counts: one active member for the applicant, `use_count` +1, one result notification, one decision Audit, revision +1. Reject asserts no member and no invitation consumption. Failed approve asserts every count remains unchanged and Pending remains readable.

- [ ] **Step 2: Run RED tests**

```powershell
cargo test --manifest-path server/Cargo.toml --test collaboration_api join_decision_ -- --ignored --test-threads=1
cargo test --manifest-path server/Cargo.toml --test collaboration_api join_request_authorization_ -- --ignored --test-threads=1
```

Expected: routes and repository operations do not exist.

- [ ] **Step 3: Implement fixed lock order and stable errors**

Use JoinRequest -> Activity -> Invitation locks for decisions. Authorize the current Owner against the locked Activity. Approve revalidates lifecycle and Invitation, creates/restores the member, consumes exactly one use, closes the request, writes applicant notification, Audit, and revision. Reject may close Pending after END/ARCHIVE and does not validate invitation usability. Deleted Activity remains unavailable through the normal Activity authorization boundary.

Map errors to stable codes and Chinese messages:

```text
JOIN_REQUEST_CLOSED: 加入申请已经处理。
ACTIVITY_NOT_JOINABLE: 当前活动不允许新成员加入。
INVITATION_INVALID: 邀请无效或已失效。
```

- [ ] **Step 4: Run GREEN and full collaboration regression**

Run the Step 2 commands, then the full `collaboration_api` ignored suite with one test thread. Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add server/src/application/collaboration.rs server/src/infrastructure/collaboration_repository.rs server/src/http/collaboration.rs server/src/http/router.rs server/tests/collaboration_api.rs
git commit -m "feat: decide activity join requests"
```

### Task 5: Notification Read Boundary

**Files:**
- Create: `server/src/application/notification.rs`
- Create: `server/src/infrastructure/notification_repository.rs`
- Create: `server/src/http/notification.rs`
- Modify: `server/src/application/mod.rs`
- Modify: `server/src/infrastructure/mod.rs`
- Modify: `server/src/http/mod.rs`
- Modify: `server/src/http/router.rs`
- Test: `server/tests/notification_api.rs`

**Interfaces:**
- Produces: `NotificationView { id, recipient_user_id, kind, target_type, target_id, activity_id, payload, read_at, created_at }`.
- Produces: `list_notifications(user_id)` ordered unread first, then `created_at DESC, id` and returning `unread_count`.
- Produces: `mark_notification_read(notification_id, user_id, now)` idempotently.
- Adds routes: `GET /api/notifications`, `POST /api/notifications/{notification_id}/read`.

- [ ] **Step 1: Write failing notification API tests**

Seed both approval notification types for two users. Assert recipient isolation, deterministic order, literal unread count, another user receives 404, first read sets `readAt`, and repeated read returns the same timestamp without a second fact or unrelated mutation.

- [ ] **Step 2: Run RED test**

```powershell
cargo test --manifest-path server/Cargo.toml --test notification_api -- --ignored --test-threads=1
```

Expected: module and routes do not exist.

- [ ] **Step 3: Implement minimal application/repository/HTTP layers**

Keep JSON payload opaque in storage but expose only a string map validated by the HTTP mapper. Build navigation from controlled target columns, never payload. Use an `UPDATE ... WHERE recipient_user_id = $2 AND read_at IS NULL RETURNING` followed by owned-row read for idempotency.

- [ ] **Step 4: Run GREEN test**

Run Step 2. Expected: all notification isolation and idempotency tests pass.

- [ ] **Step 5: Commit**

```powershell
git add server/src/application/notification.rs server/src/infrastructure/notification_repository.rs server/src/http/notification.rs server/src/application/mod.rs server/src/infrastructure/mod.rs server/src/http/mod.rs server/src/http/router.rs server/tests/notification_api.rs
git commit -m "feat: expose approval notifications"
```

### Task 6: OpenAPI And Generated Client

**Files:**
- Modify: `server/src/http/openapi.rs`
- Modify: `server/tests/openapi.rs`
- Modify: `contracts/openapi.json` (generated)
- Modify: `frontend/src/api/generated/openapi.ts` (generated)

**Interfaces:**
- Documents: `inviteMode`, Pending join result, JoinRequest list/self/decision contracts, Notification list/read contracts, 401/403/404/409 responses and CSRF requirements.
- Produces: generated TypeScript types consumed by Tasks 7–8.

- [ ] **Step 1: Write failing OpenAPI contract tests**

Assert paths and verbs exist, all new DTO schemas are referenced, Activity and Snapshot expose required `inviteMode`, Pending result can omit `memberId` and include `requestId`, and decision/read writes document CSRF plus stable error envelopes.

- [ ] **Step 2: Run RED test**

```powershell
cargo test --manifest-path server/Cargo.toml --test openapi
```

Expected: new paths/schemas are absent.

- [ ] **Step 3: Register paths and schemas, then generate artifacts**

```powershell
cargo run --manifest-path server/Cargo.toml -- openapi --output contracts/openapi.json
npm --prefix frontend run api:generate
```

- [ ] **Step 4: Verify GREEN and deterministic generation**

Run OpenAPI tests. Generate both artifacts a second time and assert `git diff` does not change after the second generation.

- [ ] **Step 5: Commit**

```powershell
git add server/src/http/openapi.rs server/tests/openapi.rs contracts/openapi.json frontend/src/api/generated/openapi.ts
git commit -m "feat: publish join approval api contract"
```

### Task 7: Frontend Adapters And Query Isolation

**Files:**
- Modify: `frontend/src/api/query-keys.ts`
- Modify: `frontend/src/features/activities/api.ts`
- Modify: `frontend/src/features/auth/api.ts`
- Create: `frontend/src/features/notifications/api.ts`
- Test: `frontend/src/features/activities/api.test.ts`
- Test: `frontend/src/features/auth/api.test.tsx`
- Create: `frontend/src/features/notifications/api.test.tsx`

**Interfaces:**
- Produces: user-scoped `joinRequests`, `joinRequest`, and `notifications` query keys.
- Produces: `useJoinRequestsQuery`, `useDecideJoinRequestMutation`, `useJoinRequestQuery`, `useNotificationsQuery`, `useMarkNotificationReadMutation`.
- Extends: `useJoinInvitationMutation` result union so only `JOINED | ALREADY_MEMBER` navigates to Activity; `PENDING_APPROVAL` remains on Join page.

- [ ] **Step 1: Write failing adapter tests**

Assert exact generated-client paths and bodies, Session user ID in every private query key, pending join does not invalidate member/accounting queries, approve invalidates members/Activity/Snapshot/join-requests/notifications, reject invalidates join-requests/notifications, and mark-read updates only the current user's notifications.

- [ ] **Step 2: Run RED tests**

```powershell
npm --prefix frontend run test:unit -- src/features/activities/api.test.ts src/features/auth/api.test.tsx src/features/notifications/api.test.tsx
```

Expected: hooks and keys do not exist or Pending result is treated as joined.

- [ ] **Step 3: Implement minimal generated-client adapters**

Use `apiClient` exclusively. Do not call `fetch` in components. Keep notifications and join requests out of IndexedDB and TanStack persistence. Reuse existing `unwrap`/error mapping conventions.

- [ ] **Step 4: Run GREEN and typecheck**

```powershell
npm --prefix frontend run test:unit -- src/features/activities/api.test.ts src/features/auth/api.test.tsx src/features/notifications/api.test.tsx
npm --prefix frontend run typecheck
```

Expected: adapter tests and typecheck pass.

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/api/query-keys.ts frontend/src/features/activities/api.ts frontend/src/features/auth/api.ts frontend/src/features/notifications
git commit -m "feat: connect join approval client adapters"
```

### Task 8: Activity, Join, And Notification UI

**Files:**
- Modify: `frontend/src/features/activities/pages.tsx`
- Modify: `frontend/src/features/auth/pages.tsx`
- Create: `frontend/src/features/notifications/pages.tsx`
- Modify: `frontend/src/app/router.tsx`
- Modify: `frontend/src/app.css`
- Test: `frontend/src/features/activities/pages.test.tsx`
- Create: `frontend/src/features/notifications/pages.test.tsx`
- Test: `frontend/src/app/router.test.tsx`

**Interfaces:**
- Activity management exposes Owner-only segmented invite mode control.
- Member Overlay exposes Owner-only Pending queue without adding an Activity navigation tab.
- Join page renders waiting state for `PENDING_APPROVAL` and applicant status query.
- Notification page renders the two frozen notification types and marks rows read independently of approval state.

- [ ] **Step 1: Write failing UI behavior tests**

Use real components with adapter boundary fakes only. Assert:

```text
Owner sees and updates 加入方式; ordinary member does not.
Owner sees Pending rows and approve/reject buttons; ordinary member never requests queue.
Failed decision preserves the row and shows the server Chinese error.
Join PENDING stays on /join/:token and shows 等待活动所有者审批.
APPROVED result offers an Activity link; REJECTED shows the rejection result.
Notification row link uses activityId/target columns, not payload URL text.
Mark-read failure preserves unread appearance and displays an error.
Activity workspace still renders only 流水 / 结算 navigation.
```

- [ ] **Step 2: Run RED tests**

```powershell
npm --prefix frontend run test:unit -- src/features/activities/pages.test.tsx src/features/notifications/pages.test.tsx src/app/router.test.tsx
```

Expected: controls/pages/states do not exist.

- [ ] **Step 3: Implement the minimal UI**

Use existing `Overlay`, `Button`, `Field`, `LoadingState`, `EmptyState`, and `ErrorNotice`. Implement the two-option join mode as a stable-width segmented control because it is a mode choice; do not create a generic component abstraction for this one use. Notification buttons use Lucide icons with accessible labels. Keep all compact panels at existing typography scale and avoid nested cards.

- [ ] **Step 4: Run GREEN, full frontend tests, and build**

```powershell
npm --prefix frontend run test:unit -- src/features/activities/pages.test.tsx src/features/notifications/pages.test.tsx src/app/router.test.tsx
npm --prefix frontend run test:unit
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Expected: focused and full frontend suites, typecheck, and production build pass.

- [ ] **Step 5: Verify responsive UI**

Start the existing local development stack against the disposable database. Use Chromium at `1440x1000` and `390x844` to inspect Activity management, Pending approval list, Join pending state, and Notification results. Assert `document.documentElement.scrollWidth === document.documentElement.clientWidth` and that Activity navigation contains exactly “流水 / 结算”. Save screenshots only under ignored `frontend/artifacts/`.

- [ ] **Step 6: Commit**

```powershell
git add frontend/src/features/activities/pages.tsx frontend/src/features/auth/pages.tsx frontend/src/features/notifications/pages.tsx frontend/src/app/router.tsx frontend/src/app.css frontend/src/features/activities/pages.test.tsx frontend/src/features/notifications/pages.test.tsx frontend/src/app/router.test.tsx
git commit -m "feat: add join approval experience"
```

### Task 9: Final Verification And Handover

**Files:**
- Modify: `docs/handovers/2026-08-31-huddletab-rust-replatform-handoff.md`

**Interfaces:**
- Records: exact commands, pass counts, browser viewports, Task 27A boundary, and remaining Task 27/28/Phase 3/release work.

- [ ] **Step 1: Run scoped Rust and PostgreSQL verification**

```powershell
cargo test --manifest-path server/Cargo.toml --test domain_activity --test domain_join_request
cargo test --manifest-path server/Cargo.toml --test activity_api --test collaboration_api --test notification_api --test snapshot_api -- --ignored --test-threads=1
cargo test --manifest-path server/Cargo.toml --test openapi
cargo fmt --manifest-path server/Cargo.toml -- --check
cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features -- -D warnings
```

Expected: all affected suites, fmt, and clippy pass with no warnings.

- [ ] **Step 2: Run scoped frontend verification**

```powershell
npm --prefix frontend run test:unit
npm --prefix frontend run typecheck
npm --prefix frontend run build
git diff --check
```

Expected: all unit tests, typecheck, production build, and whitespace check pass.

- [ ] **Step 3: Run security and scope checks**

Scan the diff for passwords, Session/CSRF values, raw invitation tokens, private keys, direct component `fetch` calls, IndexedDB notification/join-request persistence, ADMIN, Guest Binding, Attachment, Provider, tag, or publish changes. Any hit must be explained as a test fixture/type name or removed.

- [ ] **Step 4: Update handover with evidence**

State only: “Task 27A 加入审批与最小通知完成，可以继续 Task 27 Guest Binding。” Continue listing Guest Binding、Attachment、Rate Provider、其余通知事件、Task 28、Phase 3、真机 PWA 验收、Release Verification 和 `0.0.3` publication as incomplete.

- [ ] **Step 5: Commit final evidence**

```powershell
git add docs/handovers/2026-08-31-huddletab-rust-replatform-handoff.md
git commit -m "docs: record task 27a verification"
```
