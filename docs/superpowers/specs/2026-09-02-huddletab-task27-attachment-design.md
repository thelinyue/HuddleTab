# HuddleTab Task 27 Attachment 设计

日期：2026-09-02

## 1. 目标

在 Rust/Axum 与 React/Vite 新栈中恢复 `v0.0.2` 的 Expense 图片附件能力，并与 Task 24 Snapshot、Task 25 IndexedDB、Task 26 前台 Expense Queue 保持一致。

本切片完成安全图片处理、私有本地存储、受权上传与读取、离线附件队列、详情预览和孤立文件清理。它不进入 Rate Provider、其余通知事件、Task 28、Phase 3 或正式发布。

项目尚未正式发布。本设计不兼容旧 Next.js 数据库、API、IndexedDB 或上传目录，也不为当前开发期 IndexedDB 编写升级分支。

## 2. 产品边界

- 附件只属于未删除的 Expense。
- 每笔 Expense 最多三张图片；单张原图最多 10 MiB。
- 仅接受 JPEG、PNG、WebP；SVG 和其他格式一律拒绝。
- 新增支出时可选择附件；支出详情可查看附件。
- 不提供附件删除、替换、重命名、批量管理、评论或独立附件导航。
- 附件上传独立于 Expense 创建事务。Expense 已确认而附件失败时，不回滚或重新创建 Expense。
- Service Worker 不读取业务队列、不上传附件，也不缓存附件响应。

## 3. 方案选择

采用“私有文件系统 + PostgreSQL 元数据”。图片存放于 `DATA_DIR/uploads`，数据库只保存与授权、幂等和展示相关的元数据。

不采用 PostgreSQL `bytea`，避免图片扩大数据库、WAL 和备份体积；不抽象 S3 或其他对象存储，因为当前正式定位是单 Rust 进程、单实例 Docker Compose，本轮没有远程存储需求。

## 4. 数据模型

新增 `expense_attachments`：

| 字段 | 约束与用途 |
| --- | --- |
| `id` | UUID 主键 |
| `expense_id` | 引用 Expense，物理删除时级联删除元数据 |
| `client_attachment_id` | 客户端 UUID；与 `expense_id` 组成唯一约束 |
| `storage_key` | 服务端生成的私有相对路径，全表唯一 |
| `mime_type` | 固定为处理后的 `image/webp` |
| `width` / `height` | 处理后像素尺寸，必须为正数 |
| `byte_size` | 处理后字节数，必须为正数 |
| `created_at` | 服务端创建时间 |

不保存原始文件名。下载展示名可由 Attachment ID 稳定派生为 `<id>.webp`。不保存 SHA-256：当前没有去重、内容寻址或完整性校验消费者，主键、唯一约束、事务和普通测试足以覆盖本轮失败场景。

## 5. 图片与路径安全

上传边界在完整解析 multipart 前限制总请求体，允许的协议开销只覆盖一个 10 MiB 文件及固定表单字段。即使缺少或伪造 `Content-Length`，流式读取仍执行相同上限。

图片处理顺序固定为：

1. 校验原始文件字节数不超过 10 MiB。
2. 校验声明 MIME 属于 JPEG、PNG、WebP。
3. 根据 Magic Bytes 检测真实格式，并要求与声明 MIME 一致。
4. 使用解码器限制总像素不超过 4000 万，拒绝解码炸弹和损坏图片。
5. 应用 EXIF orientation；最长边限制为 2048px，不放大小图。
6. 丢弃原始元数据并编码为 WebP，输出 MIME 固定为 `image/webp`。

存储键固定由服务端 UUID 生成，形如 `<activity_id>/<expense_id>/<attachment_id>.webp`。原始文件名、请求路径和客户端字段都不能参与路径拼接。存储层仍独立拒绝空路径、绝对路径、`..`、根目录越界和符号链接逃逸；写入使用受限权限的临时文件与同目录原子 rename。

## 6. 应用与事务边界

上传分为授权预检、事务外图片处理和最终写入事务：

1. 校验 Session、CSRF、ActivityMember、Activity 生命周期和目标 Expense；查询 `(expense_id, client_attachment_id)`，命中时直接返回既有记录。
2. 预检通过后在数据库事务外安全处理图片，避免解码和缩放期间占用 Expense 行锁。
3. 开启最终写入事务，再次校验成员、生命周期和目标 Expense，防止预检后的状态变化绕过权限。
4. 锁定 Expense，并重新检查幂等键和当前附件数；并发 replay 返回胜出的既有记录。
5. 将处理后的图片写入服务端生成的私有路径。
6. 插入元数据、推进 Activity revision 一次并写入一次 `ATTACHMENT_UPLOADED` Audit。
7. 提交事务并返回公开元数据。

Expense 行锁串行化同一 Expense 的幂等检查与三张上限。幂等 replay、权限失败、校验失败、容量失败和数据库失败均不推进 revision 或写 Audit。元数据事务失败时立即补偿删除已写文件；若进程在文件落盘后、事务提交前退出，孤立文件清理器负责最终收敛。

Snapshot 在同一 `REPEATABLE READ READ ONLY` 事务中为每条 Expense 装载按 `created_at, id` 排序的附件公开元数据。附件首次成功上传推进 revision，因此 weak ETag 能感知附件变化。Snapshot、HTTP DTO、日志和 Audit 都不得包含 `storage_key` 或图片字节。

## 7. 权限与生命周期

- ACTIVE Activity 的 ACTIVE 正式成员可向未删除 Expense 上传附件。
- ENDED、ARCHIVED、DELETED Activity 禁止上传。
- LEFT 成员禁止上传。
- ACTIVE 或 LEFT 的历史 ActivityMember 可读取仍可见的未删除 Expense 附件；ENDED 和 ARCHIVED 不妨碍历史读取。
- 非成员、错误 Activity/Expense/Attachment 组合和不可见资源统一返回私有 404，不泄漏附件是否存在。
- Expense 软删除后附件不可读取；文件和元数据暂不立即删除。

不新增 Owner 专属附件权限，也不把附件权限与 Expense 更新权限绑定；这与 `v0.0.2` 的 Activity 级 `ATTACHMENT_WRITE` 语义一致。

## 8. HTTP 与 OpenAPI

### 上传

`POST /api/activities/{activity_id}/expenses/{expense_id}/attachments`

multipart 字段：

- `file`：单个图片文件。
- `clientAttachmentId`：UUID。

首次成功返回 `201 Created`，幂等重放返回 `200 OK`，两者均使用现有 `{ data }` envelope。公开记录包含 `id`、`mimeType`、`width`、`height`、`byteSize`、`createdAt`，不包含内部路径。

固定业务错误包括：

- `ATTACHMENT_TOO_LARGE`
- `ATTACHMENT_TYPE_NOT_ALLOWED`
- `ATTACHMENT_MIME_MISMATCH`
- `ATTACHMENT_IMAGE_INVALID`
- `ATTACHMENT_LIMIT_REACHED`
- 现有 Session、CSRF、成员、生命周期和资源不可见错误

### 下载

`GET /api/activities/{activity_id}/expenses/{expense_id}/attachments/{attachment_id}`

成功返回 `image/webp` 二进制，并设置：

```text
Cache-Control: private, no-store
Content-Type: image/webp
Content-Disposition: inline; filename="<attachment_id>.webp"
X-Content-Type-Options: nosniff
```

OpenAPI 明确描述 multipart 请求、`200/201` 上传响应、二进制下载响应及相关响应头。TypeScript client 由合同重新生成；组件不直接拼装未受控网络请求。

## 9. 孤立文件清理

Rust 进程启动后执行一次清理，此后每 24 小时执行一次；同一进程内不允许清理任务重入。清理器只遍历 uploads 根目录中的普通文件，不跟随符号链接。

仅当文件修改时间超过 24 小时，且数据库不存在相同 `storage_key` 元数据时才删除。数据库或文件系统失败只记录可理解的中文错误，不终止 Web 服务；日志只包含扫描数、删除数和错误类别，不输出完整存储路径或用户信息。

当前没有 Maintenance Mode，清理器不提前引入 Phase 3 状态。未来备份/恢复必须停止 App 进程后操作，届时再由对应任务定义协调边界。

## 10. 前端本地数据与同步

直接重定义尚未发布的 IndexedDB schema v1，使其包含：

- `activity_snapshots`
- `pending_mutations`
- `pending_attachments`

不编写 v1 到 v2 的迁移，不读取旧 Next.js 数据。已有开发期数据库由开发者显式清除。

`PendingAttachment` 保存 `id`、`userId`、`activityId`、`mutationId`、`clientAttachmentId`、原始显示名、声明 MIME、Blob、状态、重试计数、下次重试时间、最后错误和可选的服务端 Attachment ID。索引只包含实际消费者需要的 `by-mutation`。

选择附件后，Expense mutation 与全部 Blob 在同一个 IndexedDB read-write transaction 中原子入队。带附件的在线创建也走这条队列，从而避免维护“在线直接上传”和“离线上传恢复”两套状态机。

前台同步顺序固定为：

1. 使用 Task 26 的 `clientMutationId` 创建或重放 Expense。
2. 保存服务端 Expense ID 并把 Expense mutation 标为已确认。
3. 按本地创建顺序逐张上传附件。
4. 全部成功后刷新 Snapshot；若附件仍待同步或被拒绝，保留本地状态和 Blob。

网络错误和 5xx 使用 Task 26 相同的有限退避；确定性的 4xx 标记 `REJECTED`。附件失败绝不能把已确认 Expense 改回待创建状态。用户可以对可重试项触发立即重试，也可以明确丢弃被拒绝的本地附件；丢弃只删本机 Blob，不删除服务端 Expense 或已上传附件。

## 11. UI

新增支出高级区域沿用 `v0.0.2` 的附件选择：最多三张、`accept` 仅声明允许的三种 MIME，并在选择阶段提示数量、类型和单张大小错误。服务端仍是最终权威校验。

Expense 详情在现有内容流中增加“附件”区，以稳定网格展示懒加载缩略图；点击后在新标签打开同一个受权下载 URL。移动端和桌面端不新增主导航或管理入口，活动导航继续只有“流水 / 结算”。

待同步流水沿用 Task 26 状态区域，增加“附件待同步”和“附件被拒绝”结果，不展示 Blob URL，不把附件内容写入日志、报告或 Snapshot。

## 12. 测试与验收

测试按 RED-GREEN-REFACTOR 执行：

- Rust 单元测试：格式/Magic Bytes/MIME、10 MiB、像素上限、方向与缩放、WebP 输出、路径穿越、符号链接、原子写入和补偿删除。
- PostgreSQL 测试：schema 约束、权限/lifecycle、三张限制、并发相同幂等键、并发第四张、Audit/revision、Snapshot 元数据与 ETag。
- HTTP/OpenAPI：multipart 总体限制、CSRF、`200/201`、错误 envelope、下载私有 404、二进制响应头、内部字段不泄漏、生成结果可重复。
- Frontend Vitest：schema v1 新建三 store、Expense 与 Blob 原子入队、附件独立有限重试、4xx REJECTED、Expense 不回退、Snapshot 刷新、表单校验和详情预览。
- 浏览器：使用可丢弃 WSL PostgreSQL 与本地 Rust/Vite，Chromium Desktop `1440x1000` 和 Mobile `390x844` 验证登录、创建带附件 Expense、详情预览、断网入队、恢复联网后附件出现，以及页面无横向溢出、活动导航仅有“流水/结算”。
- 运行镜像：仅做附件变化所需的 `/data/uploads` 持久性、非 root 写入和 App 重启后下载检查；不重复未受影响的 Phase 1E 全矩阵。

## 13. 明确不做

- 不实现附件删除、替换、任意文件、PDF、原图下载或公开分享。
- 不实现对象存储、S3、CDN、缩略图多规格或后台转码队列。
- 不实现内容 hash、去重、病毒扫描或视觉 baseline。
- 不新增通知类型；Attachment 不产生站内通知。
- 不兼容旧 Next.js API、表、IndexedDB 或上传目录。
- 不进入 Rate Provider、其余通知事件、Task 28、Phase 3、真机 PWA 最终验收或 `0.0.3` 发布。
