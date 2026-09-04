# HuddleTab Task 27B Guest Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现由 Activity Owner 创建、目标用户确认的 Guest Binding，并在不改变 ActivityMember ID 和历史账务引用的前提下原地绑定账号。

**Architecture:** 复用 `activity_invites` 的 token、过期、撤销和定向用户名机制，以 nullable `guest_member_id` 区分普通加入与 Guest Binding。PostgreSQL Repository 用固定行锁顺序完成最终校验、原地绑定、邀请消费、Audit 与 revision；现有 join HTTP 入口按邀请用途分流，React 只消费 generated contract。

**Tech Stack:** Rust、Axum、SQLx、PostgreSQL、utoipa/OpenAPI、React、TypeScript、TanStack Query、Vitest、Testing Library、Playwright Chromium。

**Spec:** `docs/superpowers/specs/2026-09-02-huddletab-task27b-guest-binding-design.md`

## Global Constraints

- 只实现 Task 27B Guest Binding；不进入 Attachment、Rate Provider、其余 Notification、Task 28 或 Phase 3。
- Guest Binding 由 Owner 创建定向单次邀请，目标用户确认；不受 `inviteMode` 影响且不创建 JoinRequest。
- 成功只更新原 ActivityMember 的 `user_id` 和 version；member ID、昵称、角色、状态及历史账务引用保持不变。
- 已在 Activity 存在任何成员记录的用户不能绑定另一个 Guest；不实现账务身份合并。
- 邀请明文 token 只在创建响应和当前组件内存出现，不进入日志、文档、源码或提交。
- PostgreSQL/Docker 验证只使用 WSL 可丢弃环境，数据库测试强制 `--test-threads=1`。
- 不新增第二套邀请表、`member_type` 列、hash、baseline、contract freeze、触发器、版本表或分布式锁。
- UI 以远程 `v0.0.2` 为基准，活动主导航保持“流水 / 结算”，不恢复“字段权限”区域。
- 不创建 `v0.0.3` tag，不发布 GHCR 镜像，不宣称达到正式发布状态。

---

### Task 1: Guest Binding Invitation Schema

**Files:**
- Create: `server/migrations/202609020005_guest_binding.sql`
- Modify: `server/tests/migrations.rs`
- Modify: `server/tests/schema_constraints.rs`

**Interfaces:**
- Produces: nullable `activity_invites.guest_member_id UUID`.
- Guarantees: non-null binding target references an ActivityMember in the same Activity.
- Guarantees: a binding invitation is `DIRECT`, has `target_username`, and has `max_uses = 1`.

- [ ] **Step 1: Write failing migration and constraint tests**

Update the expected fresh migration count from `4` to `5`. Add a focused ignored PostgreSQL test that inserts two Activities and Guests, then asserts:

```rust
let cross_activity = sqlx::query(
    "INSERT INTO activity_invites (
        id, activity_id, created_by_member_id, token_hash, kind, target_username,
        expires_at, max_uses, guest_member_id, created_at
     ) VALUES ($1, $2, $3, $4, 'DIRECT', 'alice', NOW() + INTERVAL '1 day', 1, $5, NOW())",
)
.bind(Uuid::new_v4())
.bind(first_activity)
.bind(first_owner)
.bind([31_u8; 32].as_slice())
.bind(second_guest)
.execute(&mut *transaction)
.await
.expect_err("绑定邀请不能引用其他活动成员");
assert_eq!(
    constraint_name(&cross_activity),
    Some("activity_invites_activity_guest_member_fkey")
);
```

Use savepoints to separately assert that `LINK + guest_member_id`, missing target username, and `max_uses != 1` violate `activity_invites_guest_binding_shape`; a same-Activity `DIRECT` single-use row succeeds. Do not claim the CHECK can prove `user_id IS NULL`; that remains a locked application invariant.

- [ ] **Step 2: Run RED tests**

```powershell
cargo test --manifest-path server/Cargo.toml --test migrations fresh_database_migrates_and_replay_is_idempotent -- --ignored --exact --test-threads=1
cargo test --manifest-path server/Cargo.toml --test schema_constraints guest_binding_invites_enforce_activity_identity_and_shape -- --ignored --exact --test-threads=1
```

Expected: migration count remains 4 and `guest_member_id` does not exist.

- [ ] **Step 3: Add the minimal migration**

```sql
ALTER TABLE activity_invites
ADD COLUMN guest_member_id UUID;

ALTER TABLE activity_invites
ADD CONSTRAINT activity_invites_activity_guest_member_fkey
FOREIGN KEY (activity_id, guest_member_id)
REFERENCES activity_members(activity_id, id) ON DELETE RESTRICT;

ALTER TABLE activity_invites
ADD CONSTRAINT activity_invites_guest_binding_shape CHECK (
    guest_member_id IS NULL
    OR (
        kind = 'DIRECT'
        AND target_username IS NOT NULL
        AND max_uses = 1
    )
);
```

- [ ] **Step 4: Run GREEN tests**

Run both Step 2 commands. Expected: fresh migration replay and all new shape constraints pass.

- [ ] **Step 5: Commit**

```powershell
git add server/migrations/202609020005_guest_binding.sql server/tests/migrations.rs server/tests/schema_constraints.rs
git commit -m "feat: add guest binding invitation schema"
```

### Task 2: Owner Creates A Binding Invitation

**Files:**
- Modify: `server/src/application/collaboration.rs`
- Modify: `server/src/infrastructure/collaboration_repository.rs`
- Modify: `server/src/http/collaboration.rs`
- Modify: `server/src/http/router.rs`
- Modify: `server/src/http/error.rs`
- Test: `server/tests/collaboration_api.rs`
- Test: `server/tests/rate_limit_routes.rs`

**Interfaces:**
- Extends: `NewInvitation` and `Invitation` with `guest_member_id: Option<Uuid>`.
- Produces: `InvitationPurpose::{Join, GuestBinding}`, `Invitation::purpose()`, and `InvitationPurpose::as_str()`.
- Produces: `CreateGuestBindingInvitationInput { activity_id, guest_member_id, actor_user_id, target_username }`.
- Produces: `create_guest_binding_invitation(repository, codec, clock, input) -> Result<CreatedInvitation, CollaborationError>`.
- Adds: `POST /api/activities/{activity_id}/members/{member_id}/binding-invitations` with `{ targetUsername }`.
- Adds: `CollaborationError::GuestNotFound` mapped to `404 GUEST_NOT_FOUND`.

- [ ] **Step 1: Write failing owner, lifecycle, and limiter API tests**

In `collaboration_api.rs`, create an ACTIVE Guest and assert Owner creation returns `201`, a seven-day DIRECT invitation, `maxUses == 1`, matching `guestMemberId`, one-time token, `INVITATION_CREATED`, and revision +1. Add literal cases for:

```text
ordinary member -> 403
ENDED / ARCHIVED / deleted Activity -> 403
unknown member / formal member / LEFT Guest -> 404 GUEST_NOT_FOUND
invalid target username -> 400
```

In `rate_limit_routes.rs`, consume nine existing `SensitiveAuthenticated` operations for one Owner, then call the binding invitation endpoint once successfully and once more to assert `429 RATE_LIMITED`; a second user remains unaffected.

- [ ] **Step 2: Run RED tests**

```powershell
cargo test --manifest-path server/Cargo.toml --test collaboration_api guest_binding_invitation_creation_ -- --ignored --test-threads=1
cargo test --manifest-path server/Cargo.toml --test rate_limit_routes sensitive_authenticated_bucket_includes_guest_binding_invites -- --ignored --exact --test-threads=1
```

Expected: route and application operation do not exist.

- [ ] **Step 3: Add typed application input and validation**

Add `guest_member_id` to existing invitation records and constructors. Derive the public purpose without saving a duplicate database column:

```rust
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InvitationPurpose {
    Join,
    GuestBinding,
}

impl InvitationPurpose {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Join => "JOIN",
            Self::GuestBinding => "GUEST_BINDING",
        }
    }
}

impl Invitation {
    pub const fn purpose(&self) -> InvitationPurpose {
        if self.guest_member_id.is_some() {
            InvitationPurpose::GuestBinding
        } else {
            InvitationPurpose::Join
        }
    }
}
```

Implement the dedicated input:

```rust
#[derive(Clone, Debug)]
pub struct CreateGuestBindingInvitationInput {
    pub activity_id: Uuid,
    pub guest_member_id: Uuid,
    pub actor_user_id: Uuid,
    pub target_username: String,
}
```

Parse `target_username` with existing `Username`, generate the existing seven-day token, and call the existing repository creation operation with `InvitationKind::Direct`, `max_uses: Some(1)`, and `guest_member_id: Some(...)`. Keep ordinary invitation creation on `guest_member_id: None`.

- [ ] **Step 4: Enforce Guest state inside the repository transaction**

After `authorize_owner` locks the ACTIVE Activity, when `guest_member_id` is present use:

```sql
SELECT id
FROM activity_members
WHERE id = $1
  AND activity_id = $2
  AND user_id IS NULL
  AND status = 'ACTIVE'
FOR UPDATE
```

Map no row to `GuestNotFound`. Include `guest_member_id` in insert/select/list/revoke row mappings, but do not add a second repository or table. Preserve the existing `INVITATION_CREATED` Audit and revision behavior.

- [ ] **Step 5: Add HTTP route, CSRF, rate limit, and stable error**

Add `CreateGuestBindingInvitationRequest { target_username: String }`. The handler must authenticate and validate CSRF, check `SensitiveAuthenticated` before parsing business identifiers, then call the application function. Extend handwritten created/list invitation DTOs with required `purpose` and nullable `guest_member_id`, and map them from `Invitation::purpose()` and the stored target. The generated artifacts remain Task 4's responsibility.

Add:

```rust
pub fn guest_not_found(request_id: RequestId) -> Self {
    Self::new(
        StatusCode::NOT_FOUND,
        "GUEST_NOT_FOUND",
        "该临时成员不存在或已绑定账号。",
        request_id,
    )
}
```

- [ ] **Step 6: Run GREEN and focused regression tests**

Run Step 2, then:

```powershell
cargo test --manifest-path server/Cargo.toml --test collaboration_api owner_can_add_guest_and_invite_a_user_into_the_activity -- --ignored --exact --test-threads=1
```

Expected: binding creation and ordinary invitation creation both pass.

- [ ] **Step 7: Commit**

```powershell
git add server/src/application/collaboration.rs server/src/infrastructure/collaboration_repository.rs server/src/http/collaboration.rs server/src/http/router.rs server/src/http/error.rs server/tests/collaboration_api.rs server/tests/rate_limit_routes.rs
git commit -m "feat: create guest binding invitations"
```

### Task 3: Confirm Binding In One Transaction

**Files:**
- Modify: `server/src/application/collaboration.rs`
- Modify: `server/src/infrastructure/collaboration_repository.rs`
- Modify: `server/src/http/collaboration.rs`
- Modify: `server/src/http/error.rs`
- Test: `server/tests/collaboration_api.rs`
- Test: `server/tests/snapshot_api.rs`

**Interfaces:**
- Extends: `InvitationPreview` with `guest_member_id: Option<Uuid>` and `guest_display_name: Option<String>`.
- Extends: `JoinStatus` with `Bound` and `AlreadyBound`.
- Adds: `CollaborationError::GuestBindingConflict` mapped to `409 GUEST_BINDING_CONFLICT`.
- Guarantees: first bind returns the original member ID; same-token replay returns `ALREADY_BOUND`; competing users cannot both bind.

- [ ] **Step 1: Write failing end-to-end binding and Snapshot tests**

Create a Guest that is referenced by an Expense payment/share and a Settlement, create a binding invitation, register the target username through that token, and confirm it. Assert:

```rust
assert_eq!(bound["data"]["status"], "BOUND");
assert_eq!(bound["data"]["memberId"], guest_member_id.to_string());

let member = sqlx::query_as::<_, (Uuid, Option<Uuid>, String, i64)>(
    "SELECT id, user_id, display_name, version FROM activity_members WHERE id = $1",
)
.bind(guest_member_id)
.fetch_one(&pool)
.await
.expect("原 Guest 应仍存在");
assert_eq!(member.0, guest_member_id);
assert_eq!(member.1, Some(target_user_id));
assert_eq!(member.2, "原临时昵称");
assert_eq!(member.3, 2);
```

Set the Activity to `REQUIRE_APPROVAL` before confirmation. Assert every seeded accounting foreign key still equals `guest_member_id`, target user can read the Activity, no JoinRequest exists, `MEMBER_GUEST_BOUND` count is 1, and revision increases once. In `snapshot_api.rs`, compare weak ETag before/after and assert only the same member gains `userId`.

- [ ] **Step 2: Write failing invalidation and replay tests**

Cover target username mismatch, revoked/expired invitation, Activity leaving ACTIVE, target Guest becoming LEFT or bound by another user, and a target user with ACTIVE or LEFT membership. Freeze errors:

```text
existing membership -> 409 GUEST_BINDING_CONFLICT
all invalid token/final-state cases -> 404 INVALID_INVITATION
```

Repeat the same successful token with the same user and assert `ALREADY_BOUND`, identical member ID/revision, `use_count == 1`, and one binding Audit.

- [ ] **Step 3: Write the failing concurrent winner test**

Create two binding tokens for the same Guest and different usernames, register both users, then send two independent join requests with `tokio::join!`. Assert exactly one `200 BOUND`, the loser is `404 INVALID_INVITATION`, the Guest has exactly one `user_id`, only the winning invitation has `use_count == 1`, and binding Audit/revision each advance once.

- [ ] **Step 4: Run RED tests**

```powershell
cargo test --manifest-path server/Cargo.toml --test collaboration_api guest_binding_ -- --ignored --test-threads=1
cargo test --manifest-path server/Cargo.toml --test snapshot_api guest_binding_updates_snapshot_without_changing_member_identity -- --ignored --exact --test-threads=1
```

Expected: binding invitations still follow normal join/approval behavior or create a second member.

- [ ] **Step 5: Add the typed binding branch**

Extend `JoinStatus::as_str()` with `BOUND` and `ALREADY_BOUND`. Extend the preview query and handwritten preview DTO with `purpose`, nullable `guestMemberId`, and nullable `guestDisplayName`. Add `GuestBindingConflict` through repository, application, and HTTP mappings.

- [ ] **Step 6: Implement fixed locks and atomic side effects**

For binding invitations, lock Invitation and Activity first, then lock `guest_member_id`. Before rejecting exhausted usage, recognize replay only when the locked Guest has `user_id = input.user_id` and this invitation has `use_count = 1`; return `ALREADY_BOUND` without writes.

For first execution:

1. Revalidate token, username, expiry, revocation and ACTIVE Activity.
2. Require the Guest row to be ACTIVE and unbound.
3. Query any ActivityMember for `(activity_id, input.user_id) FOR UPDATE`; map a row to `GuestBindingConflict`.
4. Update the Guest `user_id` and `version = version + 1`.
5. Increment this invitation once.
6. Call `revise_and_audit` once with `MEMBER_GUEST_BOUND`, actor user equal to the confirmer and actor member equal to the now-bound Guest.

When a competitor observes the Guest already bound to a different user, return `InvalidInvitation` before modifying its own invitation.

- [ ] **Step 7: Run GREEN and collaboration/Snapshot regression**

Run Step 4, then:

```powershell
cargo test --manifest-path server/Cargo.toml --test collaboration_api -- --ignored --test-threads=1
cargo test --manifest-path server/Cargo.toml --test snapshot_api -- --ignored --test-threads=1
```

Expected: Guest Binding, normal direct join, approval join, Snapshot ETag, replay, and concurrency tests all pass.

- [ ] **Step 8: Commit**

```powershell
git add server/src/application/collaboration.rs server/src/infrastructure/collaboration_repository.rs server/src/http/collaboration.rs server/src/http/error.rs server/tests/collaboration_api.rs server/tests/snapshot_api.rs
git commit -m "feat: bind guest identities atomically"
```

### Task 4: OpenAPI And Generated Client

**Files:**
- Modify: `server/src/http/openapi.rs`
- Modify: `server/tests/openapi.rs`
- Modify: `contracts/openapi.json` (generated)
- Modify: `frontend/src/api/generated/openapi.ts` (generated)

**Interfaces:**
- Documents: binding invitation creation path, CSRF header, 201/400/401/403/404/429 responses.
- Extends: created/list invitation data with required `purpose` and nullable `guestMemberId`.
- Extends: preview data with required `purpose`, nullable `guestMemberId`, and nullable `guestDisplayName`.
- Extends: join status contract with `BOUND | ALREADY_BOUND` while preserving existing statuses.

- [ ] **Step 1: Write failing OpenAPI assertions**

Assert the new path/POST exists, uses `CreateGuestBindingInvitationRequest`, publishes required CSRF and 429 Retry-After, and returns `CreatedInvitationEnvelope`. Assert the three invitation schemas contain the frozen fields, normal nullable fields remain nullable, and the join response can publish both binding statuses.

- [ ] **Step 2: Run RED test**

```powershell
cargo test --manifest-path server/Cargo.toml --test openapi guest_binding_contract_is_explicit -- --exact
```

Expected: path and schema fields are absent.

- [ ] **Step 3: Register route and schemas, then regenerate**

Register the new utoipa path and request schema in `http/openapi.rs`. Map DTO fields from `InvitationPurpose::as_str()` and existing nullable IDs. Run:

```powershell
cargo run --manifest-path server/Cargo.toml -- openapi --output contracts/openapi.json
npm --prefix frontend run api:generate
```

- [ ] **Step 4: Verify GREEN and deterministic generation**

Run the Step 2 command, regenerate both files a second time, and verify the second generation produces no additional diff.

- [ ] **Step 5: Commit**

```powershell
git add server/src/http/openapi.rs server/tests/openapi.rs contracts/openapi.json frontend/src/api/generated/openapi.ts
git commit -m "feat: publish guest binding contract"
```

### Task 5: Frontend Adapters And Cache Invalidation

**Files:**
- Modify: `frontend/src/features/activities/api.ts`
- Modify: `frontend/src/features/auth/api.ts`
- Test: `frontend/src/features/activities/api.test.ts`
- Test: `frontend/src/features/auth/api.test.tsx`

**Interfaces:**
- Produces: `useCreateGuestBindingInvitationMutation(userId, activityId)` accepting `{ memberId, targetUsername }`.
- Guarantees: creation invalidates only the Activity invitation list.
- Guarantees: `BOUND` and `ALREADY_BOUND` invalidate the target user's current Activity list; `PENDING_APPROVAL` still does not.

- [ ] **Step 1: Write failing generated-client adapter tests**

Assert the creation hook calls:

```ts
client.POST(
  "/api/activities/{activity_id}/members/{member_id}/binding-invitations",
  {
    body: { targetUsername: "alice" },
    headers: { "X-CSRF-Token": "csrf-token" },
    params: {
      path: { activity_id: "activity-1", member_id: "guest-1" },
    },
  },
);
```

Assert success invalidates `queryKeys.invitations(userId, activityId)` and no unrelated member/Snapshot keys. Parameterize auth join adapter tests for `BOUND` and `ALREADY_BOUND` to assert Activity list invalidation, while preserving the Pending no-invalidation test.

- [ ] **Step 2: Run RED tests**

```powershell
npm --prefix frontend test -- --run src/features/activities/api.test.ts src/features/auth/api.test.tsx
```

Expected: hook is missing and generated statuses are not handled explicitly.

- [ ] **Step 3: Implement the minimal adapters**

Add a private generated-client call and one mutation hook in `activities/api.ts`; do not add a generic invitation mutation abstraction. Keep `auth/api.ts` logic status-based: only `PENDING_APPROVAL` skips invalidation, so both binding success statuses follow the existing successful join path.

- [ ] **Step 4: Run GREEN tests and typecheck**

```powershell
npm --prefix frontend test -- --run src/features/activities/api.test.ts src/features/auth/api.test.tsx
npm --prefix frontend run typecheck
```

Expected: focused adapters and generated types pass.

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/features/activities/api.ts frontend/src/features/auth/api.ts frontend/src/features/activities/api.test.ts frontend/src/features/auth/api.test.tsx
git commit -m "feat: connect guest binding adapters"
```

### Task 6: Member And Invitation UI

**Files:**
- Modify: `frontend/src/features/activities/pages.tsx`
- Modify: `frontend/src/features/auth/pages.tsx`
- Modify: `frontend/src/app.css`
- Test: `frontend/src/features/activities/pages.test.tsx`
- Test: `frontend/src/features/auth/pages.test.tsx`

**Interfaces:**
- Adds: Owner-only “绑定账号” command on ACTIVE Guest rows.
- Adds: a focused target-username form that preserves input on failure and displays the one-time token on success.
- Adds: binding-aware active invitation label and join-page copy.

- [ ] **Step 1: Write failing member UI tests**

Extend member fixtures with a Guest. Assert only ACTIVE Owner sees “绑定账号”; MEMBER, non-ACTIVE Activity, and formal members do not. Click it, enter `alice`, submit, and assert the mutation receives `{ memberId: "guest-1", targetUsername: "alice" }`. On rejection, assert the Chinese error is visible and the textbox still contains `alice`; on success, assert the token appears once.

Add an invitation fixture with `purpose: "GUEST_BINDING"`, `guestMemberId: "guest-1"`, and assert the effective invitation row reads `绑定「临时成员」给 @alice` with the existing revoke action.

- [ ] **Step 2: Write failing recipient UI tests**

Parameterize `JoinPage` preview. For `GUEST_BINDING`, assert it displays “绑定临时成员身份”、Guest nickname, and “确认绑定”; unauthenticated rendering uses “注册并绑定 / 登录”. Resolve with `BOUND` and `ALREADY_BOUND` and assert navigation to the Activity. Reject the mutation and assert the page plus binding context remain rendered.

- [ ] **Step 3: Run RED tests**

```powershell
npm --prefix frontend test -- --run src/features/activities/pages.test.tsx src/features/auth/pages.test.tsx
```

Expected: binding controls and purpose-aware copy are absent.

- [ ] **Step 4: Implement the focused UI**

Use existing `Button`, `Field`, `Input`, `ErrorNotice`, Member Overlay, and invitation display. A binding form belongs to the selected Guest row/context and contains only target username, explicit create command, error, and one-time token. Do not add a new route, generic form framework, nested card, Activity tab, field-permission panel, or notification event.

Use a Lucide account-binding icon where one already exists in the installed version; keep accessible text “绑定账号”. Add only the CSS needed for stable desktop/mobile row sizing and wrapping, with no viewport-scaled typography.

- [ ] **Step 5: Run GREEN and frontend regression**

```powershell
npm --prefix frontend test -- --run src/features/activities/pages.test.tsx src/features/auth/pages.test.tsx
npm --prefix frontend test -- --run
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Expected: focused/full Vitest, typecheck, and production build pass.

- [ ] **Step 6: Commit**

```powershell
git add frontend/src/features/activities/pages.tsx frontend/src/features/auth/pages.tsx frontend/src/app.css frontend/src/features/activities/pages.test.tsx frontend/src/features/auth/pages.test.tsx
git commit -m "feat: add guest binding experience"
```

### Task 7: Browser Verification And Handover

**Files:**
- Modify: `docs/handovers/2026-08-31-huddletab-rust-replatform-handoff.md`

**Interfaces:**
- Records: exact commands, pass counts, two Chromium viewports, Guest Binding invariants, and remaining Task 27/28/Phase 3/release work.

- [ ] **Step 1: Run scoped Rust and PostgreSQL verification**

With `TEST_DATABASE_URL` injected from the disposable WSL PostgreSQL without printing it:

```powershell
cargo test --manifest-path server/Cargo.toml --test migrations --test schema_constraints --test collaboration_api --test snapshot_api --test rate_limit_routes -- --ignored --test-threads=1
cargo test --manifest-path server/Cargo.toml --test openapi
cargo fmt --manifest-path server/Cargo.toml -- --check
cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features -- -D warnings
```

Expected: all affected database/contract suites, fmt, and clippy pass with no warnings.

- [ ] **Step 2: Verify generated artifacts and frontend**

```powershell
cargo run --manifest-path server/Cargo.toml -- openapi --output contracts/openapi.json
npm --prefix frontend run api:generate
git diff --exit-code -- contracts/openapi.json frontend/src/api/generated/openapi.ts
npm --prefix frontend test -- --run
npm --prefix frontend run typecheck
npm --prefix frontend run build
git diff --check
```

Expected: generated outputs are deterministic; full frontend unit, typecheck, build, and whitespace checks pass.

- [ ] **Step 3: Verify the real Chromium flow**

Start the Rust API and Vite dev server against the disposable WSL PostgreSQL using process-local credentials. At `1440x1000` and `390x844`, execute:

```text
Owner 登录 -> 打开成员 Overlay -> 为 Guest 创建 @target 绑定邀请
-> target 注册或登录 -> 邀请页确认绑定 -> 打开原 Activity
-> Owner 刷新成员 Overlay -> 同一 member ID 显示为正式成员
```

For both viewports assert:

```js
document.documentElement.scrollWidth === document.documentElement.clientWidth
```

and Activity navigation text is exactly `['流水', '结算']`. Save screenshots only under ignored `frontend/artifacts/`; do not place token or credentials in screenshots, traces, commands, reports, or logs.

- [ ] **Step 4: Run scope and secret checks**

Inspect the Task 27B diff for direct component `fetch`, a second invitation table, `member_type`, member merge SQL, new Notification kinds, IndexedDB invitation persistence, Attachment, Provider, tag/publish commands, passwords, Session/CSRF values, raw token fixtures outside tests, or app secrets. Remove unintended matches; explain fixed test fixtures in the verification notes without copying secret values.

- [ ] **Step 5: Update handover with measured evidence**

Record exact test counts and browser results. State only: “Task 27B Guest Binding 完成，可以继续 Task 27 Attachment。” Continue listing Attachment、Rate Provider、其余 Notification、Task 28、Phase 3、iPhone Safari/Home Screen PWA、Release Verification and `0.0.3` publication as incomplete.

- [ ] **Step 6: Commit final evidence**

```powershell
git add docs/handovers/2026-08-31-huddletab-rust-replatform-handoff.md
git commit -m "docs: record task 27b verification"
```
