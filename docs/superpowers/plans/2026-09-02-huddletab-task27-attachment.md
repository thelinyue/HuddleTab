# HuddleTab Task 27 Attachment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Rust/Axum 与 React/Vite 新栈中实现安全、私有、可离线重试的 Expense 图片附件闭环。

**Architecture:** PostgreSQL 保存附件元数据，`DATA_DIR/uploads` 保存服务端重编码后的 WebP；Application 定义附件用例与错误，PostgreSQL Repository 负责授权、行锁、幂等、文件补偿、Audit 和 revision。前端直接重定义尚未发布的 IndexedDB schema v1，通过现有 Expense 串行队列先确认 Expense，再独立重试附件。

**Tech Stack:** Rust 1.97、Axum 0.8、SQLx 0.8、PostgreSQL 18、`image`、Tokio、utoipa、React 19、TypeScript 5.9、TanStack Query、idb、Vitest、Playwright。

**Spec:** `docs/superpowers/specs/2026-09-02-huddletab-task27-attachment-design.md`

## Global Constraints

- 项目尚未正式发布；不兼容旧 Next.js API、数据库、IndexedDB 或上传目录。
- IndexedDB 继续使用 schema version 1，直接增加 `pending_attachments`，不编写升级分支。
- 每笔 Expense 最多三张；单张原图最多 10 MiB；仅 JPEG、PNG、WebP；最长边 2048px；服务端统一输出 WebP。
- 不保存或返回 SHA-256，不新增附件删除、替换、对象存储、通知或 Service Worker 业务写入。
- 首次附件上传恰好推进一次 Activity revision 并写一次 Audit；幂等 replay 和失败不推进。
- 关键事务、路径安全和队列状态机使用简洁中文注释；用户错误和部署日志使用明确中文。
- 不修改旧根目录 Next.js E2E；浏览器测试只放在 `frontend/e2e/`。
- PostgreSQL 和 Docker 验证只使用 WSL 可丢弃环境；不把凭据、Session、CSRF 或图片私有路径写入文档、报告和日志。
- 不发布、不 tag、不推送 GHCR，不宣称 `0.0.3` 可用或达到正式发布状态。

## File Responsibility Map

- `server/migrations/202609020006_expense_attachments.sql`：附件元数据、唯一约束和检查约束。
- `server/src/application/attachment.rs`：公开记录、上传/下载输入、Repository port、错误映射和用例入口。
- `server/src/infrastructure/attachment_image.rs`：Magic Bytes、解码限制、方向、缩放和 WebP 重编码。
- `server/src/infrastructure/attachment_store.rs`：私有根目录解析、原子写入、读取、删除和安全遍历。
- `server/src/infrastructure/attachment_repository.rs`：PostgreSQL 授权、幂等、行锁、三张限制、文件补偿、Audit/revision 和下载。
- `server/src/infrastructure/attachment_cleanup.rs`：超过 24 小时的孤立文件单轮清理与单循环调度。
- `server/src/http/attachment.rs`：Session/CSRF 前置校验、受限 multipart、上传 envelope 和受权二进制下载。
- `server/src/{application/expense.rs,infrastructure/expense_repository.rs,infrastructure/snapshot_repository.rs,http/expense.rs}`：把公开附件元数据投影到 Expense 与 Snapshot。
- `frontend/src/pwa/indexed-db/{schema.ts,database.ts,attachment-repository.ts,mutation-repository.ts}`：用户隔离 Blob、原子入队与状态持久化。
- `frontend/src/features/accounting/{api.ts,expense-queue.ts,expense-queue-sync.tsx,pages.tsx}`：multipart adapter、两阶段同步、状态展示、选择和详情预览。
- `frontend/e2e/attachment.spec.ts`：Desktop/Mobile Chromium 在线、离线与受权预览流程。

---

### Task 1: Publish Attachment Metadata In The Authoritative Read Model

**Files:**
- Create: `server/migrations/202609020006_expense_attachments.sql`
- Modify: `server/src/application/expense.rs`
- Modify: `server/src/infrastructure/expense_repository.rs`
- Modify: `server/src/infrastructure/snapshot_repository.rs`
- Modify: `server/src/http/expense.rs`
- Modify: `server/tests/migrations.rs`
- Modify: `server/tests/schema_constraints.rs`
- Modify: `server/tests/snapshot_api.rs`

**Interfaces:**
- Produces: `ExpenseAttachmentRecord { id, mime_type, width, height, byte_size, created_at }`.
- Produces: `ExpenseAggregate.attachments: Vec<ExpenseAttachmentRecord>` sorted by `created_at, id`.
- Produces: HTTP/OpenAPI `ExpenseAttachmentData` with camelCase public fields and no `storageKey`.

- [ ] **Step 1: Write the failing schema and Snapshot tests**

In `server/tests/schema_constraints.rs`, insert one valid attachment and verify a second row with the same `(expense_id, client_attachment_id)` is rejected by `expense_attachments_expense_client_uq`; separately verify `byte_size = 0` is rejected by `expense_attachments_positive_dimensions_and_size`.

In `server/tests/snapshot_api.rs`, seed an Expense plus one raw attachment metadata row, request the Snapshot, and assert the hand-derived public shape:

```rust
assert_eq!(snapshot["data"]["expenses"][0]["attachments"][0]["mimeType"], "image/webp");
assert_eq!(snapshot["data"]["expenses"][0]["attachments"][0]["width"], 640);
assert_eq!(snapshot["data"]["expenses"][0]["attachments"][0]["height"], 480);
assert_eq!(snapshot["data"]["expenses"][0]["attachments"][0]["byteSize"], "1234");
assert!(snapshot.to_string().find("storageKey").is_none());
```

Update `server/tests/migrations.rs` to expect six successful migrations. These tests catch a missing unique constraint, invalid zero metadata, omitted Snapshot projection, wrong ordering/serialization, and internal path disclosure.

- [ ] **Step 2: Run the tests and verify RED**

Run with a disposable WSL PostgreSQL URL in the process environment:

```powershell
cargo test --manifest-path server/Cargo.toml --test schema_constraints -- --ignored --test-threads=1
cargo test --manifest-path server/Cargo.toml --test snapshot_api -- --ignored --test-threads=1
cargo test --manifest-path server/Cargo.toml --test migrations -- --ignored --test-threads=1
```

Expected: FAIL because `expense_attachments` and `attachments` do not exist, and the migration count is still five.

- [ ] **Step 3: Add the minimal schema and projection**

Create the table with UUID primary key, Expense cascade foreign key, UUID `client_attachment_id`, unique text `storage_key`, fixed `image/webp` check, positive `width/height/byte_size`, timestamps, and the composite unique constraint. Do not add original filename or hash columns.

```sql
CREATE TABLE expense_attachments (
    id UUID PRIMARY KEY,
    expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    client_attachment_id UUID NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL CHECK (mime_type = 'image/webp'),
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    byte_size BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT expense_attachments_expense_client_uq
        UNIQUE (expense_id, client_attachment_id),
    CONSTRAINT expense_attachments_positive_dimensions_and_size
        CHECK (width > 0 AND height > 0 AND byte_size > 0)
);
```

Add to `server/src/application/expense.rs`:

```rust
#[derive(Clone, Debug)]
pub struct ExpenseAttachmentRecord {
    pub id: Uuid,
    pub mime_type: String,
    pub width: i32,
    pub height: i32,
    pub byte_size: i64,
    pub created_at: OffsetDateTime,
}
```

Load attachments in `load_aggregate` with a separate parameterized query ordered by `created_at, id`, then include them in `ExpenseAggregate`. Map them in `ExpenseAggregateData` using string serialization for `byteSize`, matching existing large integer contracts. Snapshot automatically reuses the same aggregate DTO; do not add a second attachment mapper.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the three commands from Step 2. Expected: all pass with six migrations and no internal path in JSON.

- [ ] **Step 5: Commit**

```powershell
git add server/migrations/202609020006_expense_attachments.sql server/src/application/expense.rs server/src/infrastructure/expense_repository.rs server/src/infrastructure/snapshot_repository.rs server/src/http/expense.rs server/tests/migrations.rs server/tests/schema_constraints.rs server/tests/snapshot_api.rs
git commit -m "feat: add attachment metadata read model"
```

---

### Task 2: Validate And Privately Store Images

**Files:**
- Modify: `server/Cargo.toml`
- Modify: `server/Cargo.lock`
- Create: `server/src/infrastructure/attachment_image.rs`
- Create: `server/src/infrastructure/attachment_store.rs`
- Modify: `server/src/infrastructure/mod.rs`
- Create: `server/tests/attachment_security.rs`

**Interfaces:**
- Produces: `ProcessedAttachment { bytes: Vec<u8>, mime_type: &'static str, width: i32, height: i32 }`.
- Produces: `process_attachment_image(bytes: &[u8], declared_mime: &str) -> Result<ProcessedAttachment, AttachmentImageError>`.
- Produces: `validate_image_dimensions(width: u32, height: u32) -> Result<(), AttachmentImageError>`.
- Produces: `LocalAttachmentStore::{new, write, read, remove, files_older_than}` operating only below one canonical uploads root.

- [ ] **Step 1: Write failing security tests**

Create literal fixtures at runtime with `image` only in test setup, then assert observable output and failures:

```rust
fn png_1_by_1() -> Vec<u8> {
    use std::io::Cursor;
    let mut bytes = Cursor::new(Vec::new());
    image::DynamicImage::new_rgba8(1, 1)
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    bytes.into_inner()
}

#[test]
fn rejects_type_mismatch_size_and_pixel_limit() {
    assert_eq!(
        process_attachment_image(b"<svg/>", "image/svg+xml").unwrap_err(),
        AttachmentImageError::TypeNotAllowed,
    );
    assert_eq!(
        process_attachment_image(&png_1_by_1(), "image/jpeg").unwrap_err(),
        AttachmentImageError::MimeMismatch,
    );
    assert_eq!(
        process_attachment_image(&vec![0_u8; 10 * 1024 * 1024 + 1], "image/jpeg").unwrap_err(),
        AttachmentImageError::TooLarge,
    );
    assert_eq!(
        validate_image_dimensions(8_000, 5_001).unwrap_err(),
        AttachmentImageError::PixelLimitExceeded,
    );
}

#[tokio::test]
async fn valid_png_is_reencoded_as_metadata_free_webp_with_long_edge_2048() {
    let result = process_attachment_image(&png_3000_by_1000(), "image/png").unwrap();
    assert_eq!((result.width, result.height), (2048, 683));
    assert_eq!(&result.bytes[..4], b"RIFF");
}

#[tokio::test]
#[cfg(unix)]
async fn store_rejects_symlink_escape_without_touching_outside_file() {
    use std::os::unix::fs::symlink;
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let outside_file = outside.path().join("keep.webp");
    std::fs::write(&outside_file, b"keep").unwrap();
    symlink(outside.path(), root.path().join("escape")).unwrap();
    let store = LocalAttachmentStore::new(root.path()).unwrap();
    assert_eq!(
        store.write("escape/changed.webp", b"changed").await.unwrap_err(),
        AttachmentStoreError::InvalidKey,
    );
    assert_eq!(std::fs::read(outside_file).unwrap(), b"keep");
}
```

Also verify `write` creates parent directories, uses an atomic final file, `read` returns exact bytes, and invalid writes do not leave temporary files. The symlink case is `#[cfg(unix)]` and runs in WSL; Windows still runs traversal and atomic-write cases.

- [ ] **Step 2: Run and verify RED**

```powershell
cargo test --manifest-path server/Cargo.toml --test attachment_security
```

Expected: FAIL because the image and store modules do not exist.

- [ ] **Step 3: Implement the minimum image and path policy**

Add `image` with only `jpeg`, `png`, and `webp` features; enable Tokio `fs` and `time`. Use `image::guess_format` for Magic Bytes, compare it to the declared MIME, read dimensions before full decode, reject `u64::from(width) * u64::from(height) > 40_000_000`, apply decoder orientation, resize without enlargement, and encode a new WebP buffer. Map codec details to stable Chinese application messages without logging raw bytes.

`LocalAttachmentStore` accepts only generated relative keys. Resolve and canonicalize the existing parent chain, reject path components other than normal UUID-like segments and the final `.webp`, reject symlinks, create a `0600` temporary file in the destination directory, flush it, and atomically rename it. `files_older_than` does not follow directory symlinks and returns `{ storage_key, modified_at }` only for regular `.webp` files.

- [ ] **Step 4: Run and verify GREEN**

```powershell
cargo test --manifest-path server/Cargo.toml --test attachment_security
cargo fmt --manifest-path server/Cargo.toml --check
```

Expected: all attachment security tests pass on Windows; repeat the same test under WSL so the symlink case runs.

- [ ] **Step 5: Commit**

```powershell
git add server/Cargo.toml server/Cargo.lock server/src/infrastructure/attachment_image.rs server/src/infrastructure/attachment_store.rs server/src/infrastructure/mod.rs server/tests/attachment_security.rs
git commit -m "feat: secure local attachment images"
```

---

### Task 3: Implement Authorized Idempotent Attachment Transactions

**Files:**
- Create: `server/src/application/attachment.rs`
- Modify: `server/src/application/mod.rs`
- Create: `server/src/infrastructure/attachment_repository.rs`
- Modify: `server/src/infrastructure/mod.rs`
- Create: `server/tests/attachment_repository.rs`

**Interfaces:**
- Produces: `UploadAttachmentInput { activity_id, expense_id, actor_user_id, client_attachment_id, declared_mime, bytes }`.
- Produces: `UploadAttachmentResult { attachment, idempotent_replay }`.
- Produces: `DownloadedAttachment { attachment_id, bytes }`.
- Produces: `AttachmentRepository::{upload, download}` and application functions `upload_attachment` / `download_attachment`.

- [ ] **Step 1: Write failing PostgreSQL transaction tests**

Using a real temporary uploads directory and disposable PostgreSQL, cover these independent mutations:

- first upload produces one metadata row, one file, one `ATTACHMENT_UPLOADED` Audit and revision `+1`;
- replay returns the same Attachment ID and leaves all four counts/revision unchanged;
- two concurrent uploads with the same client ID return the same Attachment ID and create one fact;
- after three distinct uploads, the fourth returns `AttachmentLimitReached` without a file or revision;
- ACTIVE member can upload; LEFT, ENDED, ARCHIVED and non-member cannot;
- LEFT historical member can download; non-member and mismatched nested IDs receive `NotFound`;
- injected metadata insert failure removes the just-written file and does not advance revision.

Use real repository calls and real filesystem effects. Do not assert on a mock store. The concurrent test must start both futures before awaiting either and verify database/file facts after both complete.

- [ ] **Step 2: Run and verify RED**

```powershell
cargo test --manifest-path server/Cargo.toml --test attachment_repository -- --ignored --test-threads=1
```

Expected: FAIL because the application and PostgreSQL attachment repositories do not exist.

- [ ] **Step 3: Implement the minimal use case and repository**

Define stable errors for invalid image, limit reached, forbidden/not found, missing file and unavailable storage. `PostgresAttachmentRepository::upload` performs:

```rust
pub async fn upload_attachment(
    repository: &dyn AttachmentRepository,
    input: UploadAttachmentInput,
) -> Result<UploadAttachmentResult, AttachmentError> {
    repository.upload(input).await.map_err(AttachmentError::from)
}

#[async_trait]
pub trait AttachmentRepository: Send + Sync {
    async fn upload(
        &self,
        input: UploadAttachmentInput,
    ) -> Result<UploadAttachmentResult, AttachmentRepositoryError>;

    async fn download(
        &self,
        activity_id: Uuid,
        expense_id: Uuid,
        attachment_id: Uuid,
        actor_user_id: Uuid,
    ) -> Result<DownloadedAttachment, AttachmentRepositoryError>;
}
```

The repository implementation follows `authorized replay preflight -> process image outside write transaction -> final authorization -> lock Expense -> replay recheck -> count check -> write generated file -> insert metadata -> revision + Audit -> commit`.

The final transaction repeats authorization and lifecycle checks. Hold the Expense row lock while checking the three-item limit. Generate storage keys exclusively as `<activity>/<expense>/<attachment>.webp`. On every error after a new file is written, attempt removal and log only a Chinese category message if compensation itself fails.

Download joins Attachment -> Expense -> Activity, authorizes an ACTIVE or LEFT member, rejects deleted Expense/Activity and mismatched nested IDs, then reads the database-owned storage key through `LocalAttachmentStore`.

- [ ] **Step 4: Run and verify GREEN**

Run the command from Step 2. Expected: all authorization, idempotency, concurrency, revision and compensation tests pass.

- [ ] **Step 5: Commit**

```powershell
git add server/src/application/attachment.rs server/src/application/mod.rs server/src/infrastructure/attachment_repository.rs server/src/infrastructure/mod.rs server/tests/attachment_repository.rs
git commit -m "feat: persist authorized expense attachments"
```

---

### Task 4: Publish Multipart Upload And Private Download APIs

**Files:**
- Modify: `server/Cargo.toml`
- Modify: `server/Cargo.lock`
- Create: `server/src/http/attachment.rs`
- Modify: `server/src/http/mod.rs`
- Modify: `server/src/http/router.rs`
- Modify: `server/src/http/error.rs`
- Modify: `server/src/http/openapi.rs`
- Modify: `server/src/main.rs`
- Create: `server/tests/attachment_api.rs`
- Modify: `server/tests/openapi.rs`
- Modify: `contracts/openapi.json`
- Modify: `frontend/src/api/generated/openapi.ts`

**Interfaces:**
- Produces: `POST /api/activities/{activity_id}/expenses/{expense_id}/attachments` with multipart `file` and `clientAttachmentId`.
- Produces: `GET /api/activities/{activity_id}/expenses/{expense_id}/attachments/{attachment_id}` returning private `image/webp`.
- Produces: `AppState::with_uploads_dir(PathBuf)`; production main sets it from `DATA_DIR/uploads` while unrelated tests keep the existing constructor.

- [ ] **Step 1: Write failing route and OpenAPI tests**

In `server/tests/attachment_api.rs`, use the real router, real Session/CSRF flow, real database and a temp uploads directory. Assert:

- valid multipart returns `201`, replay returns `200`, and JSON omits storage fields;
- missing/invalid CSRF is rejected before an invalid 10 MiB body is decoded;
- multipart over the fixed total limit returns JSON `422 ATTACHMENT_TOO_LARGE` rather than an extractor text response;
- malformed client UUID and missing file return the existing JSON error envelope;
- download returns exact `RIFF` bytes plus `private, no-store`, `image/webp`, inline ID filename and `nosniff`;
- a non-member receives private 404.

In `server/tests/openapi.rs`, assert the multipart content type, binary file schema, `200/201/400/401/403/404/409/422/500` upload responses, binary download response and four response headers.

- [ ] **Step 2: Run and verify RED**

```powershell
cargo test --manifest-path server/Cargo.toml --test attachment_api -- --ignored --test-threads=1
cargo test --manifest-path server/Cargo.toml --test openapi
```

Expected: FAIL because routes and contract are absent.

- [ ] **Step 3: Implement handlers and contract**

Enable Axum `multipart`. The upload handler accepts the raw `Request`, validates Session and CSRF and resolves the current user before constructing `Multipart`, so unauthorized callers do not trigger image parsing. Read exactly one `file` and one UUID `clientAttachmentId`; reject duplicates and unknown oversized data with the stable JSON envelope. Apply a route-local multipart body limit of `10 MiB + 64 KiB` and translate all multipart rejection paths.

Build download with `Body::from(bytes)` and fixed private headers. Add attachment errors to `ApiError` without exposing codec, SQL or filesystem details. Register both operations and `ExpenseAttachmentData` in utoipa.

Keep `AppState::new` source-compatible for existing tests; add a builder that overrides the uploads root. In `main.rs`, compute `uploads_dir = data_dir.join("uploads")`, install it into state, and do not print it in request logs.

```rust
let state = AppState::new(database.clone(), app_secret, base_origin)
    .with_uploads_dir(data_dir.join("uploads"));

let upload_route = post(attachment::upload)
    .layer(DefaultBodyLimit::max(10 * 1024 * 1024 + 64 * 1024))
    .fallback(api_method_not_allowed);
```

- [ ] **Step 4: Generate and verify GREEN**

```powershell
cargo run --manifest-path server/Cargo.toml -- openapi --output contracts/openapi.json
npm --prefix frontend run api:generate
cargo test --manifest-path server/Cargo.toml --test attachment_api -- --ignored --test-threads=1
cargo test --manifest-path server/Cargo.toml --test openapi
git diff --check
```

Expected: route tests and OpenAPI pass; generated files contain no internal storage field.

- [ ] **Step 5: Commit**

```powershell
git add server/Cargo.toml server/Cargo.lock server/src/http/attachment.rs server/src/http/mod.rs server/src/http/router.rs server/src/http/error.rs server/src/http/openapi.rs server/src/main.rs server/tests/attachment_api.rs server/tests/openapi.rs contracts/openapi.json frontend/src/api/generated/openapi.ts
git commit -m "feat: publish private attachment APIs"
```

---

### Task 5: Reclaim Orphan Files Without A Second Job System

**Files:**
- Create: `server/src/infrastructure/attachment_cleanup.rs`
- Modify: `server/src/infrastructure/mod.rs`
- Modify: `server/src/main.rs`
- Create: `server/tests/attachment_cleanup.rs`

**Interfaces:**
- Produces: `cleanup_orphan_attachments(pool, store, cutoff) -> CleanupResult { scanned, deleted }`.
- Produces: `spawn_attachment_cleanup(pool, uploads_dir)` with one immediate run and one sequential run every 24 hours.

- [ ] **Step 1: Write failing cleanup tests**

With real temp files and PostgreSQL metadata, create four files: recent orphan, old referenced, old orphan, and a symlink. Assert only the old orphan is deleted; the returned literal result is `scanned: 3, deleted: 1`; the symlink target remains. Add a no-directory case returning zeros. Use a failing database connection case to prove no file is deleted when metadata authority is unavailable.

- [ ] **Step 2: Run and verify RED**

```powershell
cargo test --manifest-path server/Cargo.toml --test attachment_cleanup -- --ignored --test-threads=1
```

Expected: FAIL because cleanup does not exist.

- [ ] **Step 3: Implement one sequential cleanup loop**

Reuse `LocalAttachmentStore::files_older_than`; for each candidate query `expense_attachments.storage_key`, deleting only an explicit database miss. The scheduler is one Tokio task with `interval`, awaits each run before the next tick, logs Chinese counts, and catches errors without stopping HTTP. Do not add a generic scheduler, distributed lock or Maintenance Mode.

```rust
pub fn spawn_attachment_cleanup(pool: PgPool, uploads_dir: PathBuf) {
    tokio::spawn(async move {
        let store = match LocalAttachmentStore::new(&uploads_dir) {
            Ok(store) => store,
            Err(error) => {
                tracing::error!(error = %error, "无法启动孤立附件清理，请检查数据目录权限");
                return;
            }
        };
        let mut interval = tokio::time::interval(Duration::from_secs(24 * 60 * 60));
        loop {
            interval.tick().await;
            if let Err(error) = cleanup_orphan_attachments(
                &pool,
                &store,
                OffsetDateTime::now_utc() - time::Duration::hours(24),
            ).await {
                tracing::error!(error = %error, "孤立附件清理失败，请检查数据库和数据目录权限");
            }
        }
    });
}
```

- [ ] **Step 4: Run and verify GREEN**

Run the command from Step 2. Expected: only the old unreferenced regular file is removed.

- [ ] **Step 5: Commit**

```powershell
git add server/src/infrastructure/attachment_cleanup.rs server/src/infrastructure/mod.rs server/src/main.rs server/tests/attachment_cleanup.rs
git commit -m "feat: clean orphan attachment files"
```

---

### Task 6: Atomically Queue Expense Mutations And Attachment Blobs

**Files:**
- Modify: `frontend/src/pwa/indexed-db/schema.ts`
- Modify: `frontend/src/pwa/indexed-db/database.ts`
- Create: `frontend/src/pwa/indexed-db/attachment-repository.ts`
- Modify: `frontend/src/pwa/indexed-db/mutation-repository.ts`
- Modify: `frontend/src/pwa/indexed-db/database.test.ts`
- Modify: `frontend/src/pwa/indexed-db/mutation-repository.test.ts`
- Create: `frontend/src/pwa/indexed-db/attachment-repository.test.ts`

**Interfaces:**
- Produces: `PendingAttachment` with `PENDING | SYNCING | RETRYABLE | REJECTED | SYNCED` status and Blob.
- Produces: `PendingAttachmentDraft { id, clientAttachmentId, fileName, mimeType, blob }`.
- Produces: `MutationRepository.enqueueWithAttachments(mutation, attachmentDrafts)` using one IndexedDB transaction.
- Produces: `AttachmentRepository::{listByMutation, listByActivity, put, removeRejectedForMutation}`.

- [ ] **Step 1: Write failing IndexedDB tests**

Use `fake-indexeddb` with a fresh user database per test. Assert schema version remains exactly 1 and a fresh database has exactly three stores. Then call the wished-for atomic method with one Expense and two literal Blob objects:

```ts
const result = await repository.enqueueWithAttachments(mutation, [
  { id: "attachment-1", clientAttachmentId: "client-1", fileName: "one.png",
    mimeType: "image/png", blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }) },
  { id: "attachment-2", clientAttachmentId: "client-2", fileName: "two.webp",
    mimeType: "image/webp", blob: new Blob([new Uint8Array([4, 5])], { type: "image/webp" }) },
]);
expect(result.attachments.map(({ mutationId, mimeType, blob }) =>
  [mutationId, mimeType, blob.size])).toEqual([
    [mutation.id, "image/png", 3],
    [mutation.id, "image/webp", 2],
  ]);
```

Call the same method with two drafts that both use `id: "duplicate"`; the second `add` must abort the transaction, after which neither mutation nor Blob may remain. Verify another user database cannot list successful records. This catches a split transaction, wrong user boundary, missing Blob and accidental schema-v2 compatibility branch without adding a test-only production hook.

- [ ] **Step 2: Run and verify RED**

```powershell
npm --prefix frontend test -- --run src/pwa/indexed-db/database.test.ts src/pwa/indexed-db/mutation-repository.test.ts src/pwa/indexed-db/attachment-repository.test.ts
```

Expected: FAIL because the store, type and repository are absent.

- [ ] **Step 3: Implement the minimal schema-v1 store and repositories**

Add only `by-mutation` because it has a concrete queue consumer. `enqueueWithAttachments` opens one read-write transaction over `pending_mutations` and `pending_attachments`, combines the caller-provided stable IDs with the current `userId` and initial state, writes the mutation and all Blob records with `add`, then awaits `transaction.done`. `ExpenseQueue.enqueue` creates independent `crypto.randomUUID()` attachment/client IDs before calling the repository. Do not add an upgrade branch keyed by `oldVersion`; fresh schema v1 creates all three stores together.

```ts
export interface HuddleTabDb extends DBSchema {
  activity_snapshots: { key: string; value: ActivitySnapshotRecord };
  pending_mutations: {
    key: string;
    value: PendingExpenseMutation;
    indexes: { "by-activity": string };
  };
  pending_attachments: {
    key: string;
    value: PendingAttachment;
    indexes: { "by-mutation": string };
  };
}

const transaction = database.transaction(
  ["pending_mutations", "pending_attachments"],
  "readwrite",
);
await transaction.objectStore("pending_mutations").add(mutationRecord);
for (const attachment of attachmentRecords) {
  await transaction.objectStore("pending_attachments").add(attachment);
}
await transaction.done;
```

- [ ] **Step 4: Run and verify GREEN**

Run the command from Step 2 and `npm --prefix frontend run typecheck`. Expected: all repository tests and typecheck pass.

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/pwa/indexed-db/schema.ts frontend/src/pwa/indexed-db/database.ts frontend/src/pwa/indexed-db/attachment-repository.ts frontend/src/pwa/indexed-db/mutation-repository.ts frontend/src/pwa/indexed-db/database.test.ts frontend/src/pwa/indexed-db/mutation-repository.test.ts frontend/src/pwa/indexed-db/attachment-repository.test.ts
git commit -m "feat: queue attachment blobs atomically"
```

---

### Task 7: Synchronize Attachments And Restore The v0.0.2 UI

**Files:**
- Modify: `frontend/src/features/accounting/api.ts`
- Modify: `frontend/src/features/accounting/api.test.tsx`
- Modify: `frontend/src/features/accounting/expense-queue.ts`
- Modify: `frontend/src/features/accounting/expense-queue.test.ts`
- Modify: `frontend/src/features/accounting/expense-queue-sync.tsx`
- Modify: `frontend/src/features/accounting/expense-queue-sync.test.tsx`
- Modify: `frontend/src/features/accounting/pages.tsx`
- Modify: `frontend/src/features/accounting/pages-ui.test.tsx`
- Modify: `frontend/src/app.css`

**Interfaces:**
- Produces: `uploadExpenseAttachment(activityId, expenseId, pendingAttachment)` using generated multipart contract and CSRF.
- Changes: `ExpenseQueue.enqueue(activityId, payload, files = [])` atomically stores selected files.
- Changes: after Expense `SYNCED`, the same foreground queue independently drains attachments and refreshes authoritative queries.
- Produces: accessible attachment selector and private detail preview grid.

- [ ] **Step 1: Write failing adapter and queue tests**

Adapter test supplies a real `File`, intercepts the generated client call at the network boundary, and verifies the emitted multipart contains the same Blob bytes, `clientAttachmentId`, activity/expense IDs and CSRF header. It must assert on the resulting metadata, not merely on a mock call count.

Queue tests cover:

- files force the existing Expense enqueue path even while online;
- Expense is marked `SYNCED` before attachment upload begins;
- attachment network/5xx failure changes only Attachment to `RETRYABLE` and never calls Expense Create twice;
- attachment 4xx becomes `REJECTED`, preserves Blob, and exposes “附件被服务器拒绝”；
- a later `flush()` retries attachments belonging to an already-SYNCED Expense;
- two attachments upload serially in local creation order;
- all attachment success dispatches one authoritative invalidation event.

Use the real IndexedDB repositories with `fake-indexeddb`; inject only the network send functions and clock/sleep.

- [ ] **Step 2: Run and verify RED**

```powershell
npm --prefix frontend test -- --run src/features/accounting/api.test.tsx src/features/accounting/expense-queue.test.ts src/features/accounting/expense-queue-sync.test.tsx
```

Expected: FAIL because queue inputs and two-stage synchronization are absent.

- [ ] **Step 3: Implement the minimal two-stage foreground queue**

Use the generated multipart operation with a `FormData` body serializer; do not add component `fetch`. Keep Task 26 retry delays `[1000, 5000]` and three total attempts. An Expense transitions to `SYNCED` as soon as its server ID is known. Attachment retries use their own counters and statuses; `flush()` first processes sendable Expense records, then attachments whose mutation is `SYNCED` and has `serverExpenseId`.

```ts
export async function uploadExpenseAttachment(
  activityId: string,
  expenseId: string,
  attachment: PendingAttachment,
) {
  const formData = new FormData();
  formData.set("file", attachment.blob, attachment.fileName);
  formData.set("clientAttachmentId", attachment.clientAttachmentId);
  return unwrap(await apiClient.POST(
    "/api/activities/{activity_id}/expenses/{expense_id}/attachments",
    {
      params: { path: { activity_id: activityId, expense_id: expenseId } },
      body: {
        file: attachment.fileName,
        clientAttachmentId: attachment.clientAttachmentId,
      },
      bodySerializer: () => formData,
      headers: await mutationHeaders(),
    },
  )).data;
}
```

Extend the queue-changed event with attachment status only as needed by `ExpenseQueueSync`; invalidate Expense detail/list and Snapshot-related authoritative keys after final upload. Query local mutation and attachment repositories together so the feed can distinguish unsynced Expense rows from authoritative rows whose attachment is pending/rejected.

- [ ] **Step 4: Write the failing UI tests**

In `pages-ui.test.tsx`, render the real `ExpenseEditor` and `ExpenseDetailPage` around complete API fixtures. Assert:

- create mode shows “附件（最多三张）” and accepts only `.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp`;
- four files, a file over 10 MiB, and SVG each preserve the form and show the matching Chinese error;
- edit mode has no attachment selector;
- submit passes the exact selected `File[]` to the create mutation;
- ACTIVE, ENDED and ARCHIVED detail variants all show public attachment images through the nested private API URL;
- the DOM contains no `storageKey`, Blob URL or internal path;
- synchronized Expense rows show attachment pending/rejected status without being duplicated in the “待同步” Expense group.

- [ ] **Step 5: Run UI tests and verify RED**

```powershell
npm --prefix frontend test -- --run src/features/accounting/pages-ui.test.tsx
```

Expected: FAIL because selection, status and preview UI are absent.

- [ ] **Step 6: Implement and verify GREEN**

Add `files` state only for create mode, validate count/type/size before enqueue, and keep all existing Expense fields on error. Render an unframed “附件” section after facts/notes in both editable and read-only details; use `<img loading="lazy">` inside links opening the authorized API URL. Add stable responsive grid dimensions and ensure images cannot resize the layout.

Run:

```powershell
npm --prefix frontend test -- --run src/pwa/indexed-db src/features/accounting/api.test.tsx src/features/accounting/expense-queue.test.ts src/features/accounting/expense-queue-sync.test.tsx src/features/accounting/pages-ui.test.tsx
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Expected: all focused frontend tests, typecheck and production build pass.

- [ ] **Step 7: Commit**

```powershell
git add frontend/src/features/accounting/api.ts frontend/src/features/accounting/api.test.tsx frontend/src/features/accounting/expense-queue.ts frontend/src/features/accounting/expense-queue.test.ts frontend/src/features/accounting/expense-queue-sync.tsx frontend/src/features/accounting/expense-queue-sync.test.tsx frontend/src/features/accounting/pages.tsx frontend/src/features/accounting/pages-ui.test.tsx frontend/src/app.css
git commit -m "feat: complete offline attachment experience"
```

---

### Task 8: Verify Runtime Persistence, Update Handover, And Commit The Checkpoint

**Files:**
- Create: `frontend/e2e/attachment.spec.ts`
- Modify: `frontend/playwright.config.ts`
- Modify: `frontend/e2e/run-phase1e.ps1`
- Modify: `frontend/e2e/support/persistence-check.mjs`
- Modify: `docs/handovers/2026-08-31-huddletab-rust-replatform-handoff.md`
- Modify only files required to fix failures introduced by Tasks 1–7.

**Interfaces:**
- Produces: optional `-AttachmentOnly` mode on the existing new-stack runner; default Phase 1E behavior remains unchanged.
- Produces: Desktop `1440x1000` and Mobile `390x844` Chromium attachment evidence.
- Records: exact commands, pass counts, artifact paths, image/storage result and remaining Task 27/28/Phase 3/release work.

- [ ] **Step 1: Write the browser test and runner safety test first**

Add an attachment Playwright project for each Chromium viewport. The test performs real UI steps:

```text
login -> create Activity -> open quick Expense -> select in-memory PNG
-> set browser offline -> save to IndexedDB -> verify waiting state
-> restore online -> wait for authoritative Expense and attachment preview
-> open detail/download -> verify image/webp and private headers
-> verify navigation exactly 流水/结算 and no horizontal overflow
```

The test saves a redacted success screenshot for each viewport and never writes image bytes, credentials, Session or CSRF to logs. Extend the runner with an `-AttachmentOnly` switch that selects only these two projects while retaining the same temporary Compose project, credential stdin, artifact sanitizer and `finally` cleanup. Extend the existing runner safety test to prove default invocation remains the full matrix and AttachmentOnly cannot inject arbitrary Playwright arguments.

```ts
const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("离线创建的图片附件恢复联网后可受权查看", async ({ page, context }, testInfo) => {
  await login(page);
  await createActivity(page, `Attachment ${testInfo.project.name}`);
  await page.getByRole("button", { name: "快速记账" }).click();
  const title = `附件餐费 ${testInfo.project.name}`;
  await page.getByLabel("金额").fill("12.34");
  await page.getByLabel("标题").fill(title);
  await page.getByLabel("附件（最多三张）").setInputFiles({
    name: "receipt.png",
    mimeType: "image/png",
    buffer: onePixelPng,
  });
  await context.setOffline(true);
  await page.getByRole("button", { name: "保存账单" }).click();
  await expect(page.getByText("等待同步")).toBeVisible();
  await context.setOffline(false);
  await page.getByRole("link", { name: new RegExp(title) }).click();
  await expect(page.getByRole("img", { name: /附件/ })).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await saveChromiumSuccessScreenshot(page, testInfo);
});
```

- [ ] **Step 2: Run the runner safety test and verify RED**

```powershell
& ./frontend/e2e/support/run-phase1e-safety.test.ps1
```

Expected: FAIL because `-AttachmentOnly` is absent.

- [ ] **Step 3: Implement the scoped runner and attachment persistence check**

In AttachmentOnly mode, run exactly `attachment.spec.ts` in the two fixed Chromium projects. After app restart and PostgreSQL+app restart, `persistence-check.mjs` logs in with environment credentials, locates the test Expense through authorized APIs, downloads its attachment, and requires `Content-Type: image/webp` plus a non-empty `RIFF` body. It prints only a Chinese pass/fail summary.

- [ ] **Step 4: Run all scoped automated verification**

With the disposable WSL database and `--test-threads=1` for PostgreSQL suites:

```powershell
cargo test --manifest-path server/Cargo.toml --test attachment_security
cargo test --manifest-path server/Cargo.toml --test attachment_repository -- --ignored --test-threads=1
cargo test --manifest-path server/Cargo.toml --test attachment_api -- --ignored --test-threads=1
cargo test --manifest-path server/Cargo.toml --test attachment_cleanup -- --ignored --test-threads=1
cargo test --manifest-path server/Cargo.toml --test snapshot_api -- --ignored --test-threads=1
cargo test --manifest-path server/Cargo.toml --test schema_constraints -- --ignored --test-threads=1
cargo test --manifest-path server/Cargo.toml --test migrations -- --ignored --test-threads=1
cargo test --manifest-path server/Cargo.toml --test openapi
cargo run --manifest-path server/Cargo.toml -- openapi --output contracts/openapi.json
npm --prefix frontend run api:generate
git diff --exit-code -- contracts/openapi.json frontend/src/api/generated/openapi.ts
npm --prefix frontend test -- --run src/pwa/indexed-db src/features/accounting
npm --prefix frontend run typecheck
npm --prefix frontend run build
cargo fmt --manifest-path server/Cargo.toml --check
cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features -- -D warnings
& ./frontend/e2e/support/run-phase1e-safety.test.ps1
& ./frontend/e2e/run-phase1e.ps1 -AttachmentOnly
git diff --check
```

Expected: all commands pass; OpenAPI generation is clean; both Chromium viewports pass; uploads survive app and PostgreSQL restarts; container UID 10001 can write `/data/uploads`; cleanup removes only the validated temporary Compose project and WSL path while preserving sanitized reports.

- [ ] **Step 5: Perform a scoped review**

Review the diff from commit `235477d` and reject any unrelated Rate Provider, new notification type, attachment deletion, object storage, Service Worker write, IndexedDB version migration, hash, legacy compatibility, tag or publish change. Confirm no component calls raw `fetch`, no response/log exposes `storage_key`, and no activity navigation other than “流水 / 结算” was added.

- [ ] **Step 6: Update handover with exact evidence**

Update the current conclusion, feature table, verification section and next priorities. State only: “Task 27 Attachment 完成，可以继续 Task 27 Rate Provider 与其余通知事件。” Continue listing Rate Provider、其余通知、Task 28、Tasks 29–31、iPhone Safari/Home Screen PWA 人工验收、Release Verification and `0.0.3` publication as incomplete.

- [ ] **Step 7: Commit the final checkpoint**

```powershell
git add frontend/e2e/attachment.spec.ts frontend/playwright.config.ts frontend/e2e/run-phase1e.ps1 frontend/e2e/support/persistence-check.mjs docs/handovers/2026-08-31-huddletab-rust-replatform-handoff.md
git commit -m "docs: record task 27 attachment verification"
git status --short --branch
```

Expected: worktree clean on `codex/rust-replatform`; no tag or remote image action performed.
