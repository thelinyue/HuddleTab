# HuddleTab React/Vite + Rust/Axum Replatform Design

> **Status:** FROZEN
>
> **Date:** 2026-08-31
>
> **Scope:** React/Vite PWA + Rust/Axum 模块化单体迁移总纲
>
> **Deployment:** 同源 `app + postgres` 双服务 Compose

## 1. 文档目的

本文冻结 HuddleTab 从 Next.js 模块化单体迁移到 React/Vite PWA 与 Rust/Axum 模块化单体的实现边界。迁移保留已经验收的产品需求、视觉设计、UI 原语和交互成果，重建服务端、认证、数据库 Schema 与 API Contract。

旧 Next.js 服务端从实施开始冻结，只允许只读参考。本次迁移不提供旧数据库、API、Session 或部署兼容层，也不长期维护双后端。

## 2. 成功标准

Phase 1 完成必须同时满足：

- React/Vite 前端可以完成认证、活动、成员、邀请、账单、账本和结算核心流程。
- Rust 是账务、权限、生命周期、幂等、审计和并发控制的唯一权威实现。
- Rust DTO 经 utoipa 导出 OpenAPI，TypeScript DTO 只由 OpenAPI 生成。
- Axum 同源托管 `/api/*` 与 Vite 静态产物，前端路由统一回退 `index.html`。
- PostgreSQL 使用新 Schema 从空库启动；没有旧数据迁移路径。
- 生产镜像以非 root 用户运行，运行时不存在 Node.js、Next.js、Better Auth 或 Drizzle。
- Chromium 核心矩阵、WebKit 关键回归、Rust/TypeScript golden tests 和安全并发验收全部通过。

## 3. 范围与阶段

### 3.1 Phase 1

- React Router、TanStack Query、PWA shell 和 generated API client。
- 用户登录、登出、当前会话、改密和邀请注册。
- Activity、ActivityMember、Guest、Direct Invitation。
- Expense CRUD、多人付款、四种分摊、手工汇率、幂等、审计与 Revision。
- Ledger、Balance、Recommendation、Settlement create/update/void。
- PostgreSQL migration、CLI bootstrap、OpenAPI 导出、静态托管和 Docker 发布。

### 3.2 Phase 2

- Snapshot ETag、IndexedDB、离线 Expense Create Queue。
- 审批、Guest Binding、Notification、Attachment、汇率 Provider/Cache。
- 完整生命周期和 PWA 更新恢复。

### 3.3 Phase 3

- System Admin、Registration Policy、管理员密码重置和初始化 UI。
- CSV、Sharing Summary、系统设置与外围管理能力。

### 3.4 明确非目标

- 不引入 WASM、Redis、消息队列、微服务或 Background Sync。
- 不实现 delta snapshot、CRDT、客户端 Ledger 或离线 Settlement。
- Phase 1 汇率只支持 `IDENTITY` 与 `MANUAL`。
- Phase 1 不承诺 Firefox 完整矩阵。
- 不重新设计已验收 UI，不替换现有视觉资产。

## 4. 代码与运行架构

目录固定为：

```text
frontend/   React、Vite、React Router、TanStack Query、PWA、IndexedDB
server/     单 Rust crate：domain/application/infrastructure/http
contracts/  Rust/utoipa 自动导出的 OpenAPI
golden/     Rust 与 TypeScript 共用的账务测试向量
```

依赖方向：

```text
frontend component
  -> feature adapter / query hook
  -> generated openapi client
  -> Axum HTTP DTO
  -> application use case
  -> domain + repository ports
  -> SQLx / PostgreSQL
```

Rust 模块职责：

- `domain`：纯 Rust；包含 Currency、Money、ExchangeRate、Splitting、Ledger、Balance、Settlement 和 Permission Policy。
- `application`：用例编排；负责权限、生命周期、事务、Audit、Revision、Notification 和端口定义。
- `infrastructure`：SQLx Repository、Session、PasswordHasher、Clock、文件存储和静态文件实现。
- `http`：Axum 路由、DTO、Cookie、CSRF、OpenAPI、安全中间件与错误映射。

约束：

- SQLx row、Domain entity、HTTP DTO 严格分离，禁止跨层复用结构体。
- 仅在真实替换边界建立 trait；Domain 内部纯计算不抽象成 trait。
- 一个二进制提供 `serve`、`bootstrap-user`、`openapi` 子命令。
- `serve` 启动时执行兼容 migration，再监听 `0.0.0.0:5660`。
- `/api/*` 永不回退 HTML；未知 API 和方法错误均返回统一 JSON。
- 非 API GET/HEAD 路由在静态文件不存在时回退 `index.html`。

## 5. 数据模型

### 5.1 Phase 1 表

```text
users
sessions
security_rate_limits
activities
activity_members
activity_invites
expenses
expense_payments
expense_shares
settlements
activity_audit_logs
```

所有主键使用 UUID。数据库时间统一使用 `TIMESTAMPTZ`，由应用 Clock 产生并由数据库约束兜底。

### 5.2 账务身份与复合外键

`ActivityMember` 是唯一账务身份。User 仅用于登录和成员绑定，所有 Owner、Payer、Share 和 Settlement 关系都引用成员。

每个涉及成员的账务表同时保存 `activity_id` 与成员 ID，并通过 `(activity_id, member_id)` 复合外键约束，阻止跨活动引用。`activities.owner_member_id` 同样使用复合外键；每个活动仅允许一个有效 OWNER。

### 5.3 金额事实

Expense、每条 Payment、每条 Share 都保存：

```text
original_currency
original_amount_minor BIGINT
base_currency
base_amount_minor BIGINT
```

正式金额规则：

- PostgreSQL 使用 `BIGINT`，Rust 使用 `i64`，HTTP 使用十进制字符串。
- 乘除中间值必须使用 checked `i128`，溢出返回稳定业务错误。
- 不使用 JavaScript number、Rust float 或 PostgreSQL float 计算正式金额。
- 数据库检查总额、币种和活动主币种的一致性；应用事务检查 payment/share 守恒。

### 5.4 汇率与尾差

汇率定义为：

```text
1 原币主单位 = N 活动主币主单位
```

使用 PostgreSQL `NUMERIC` 与 Rust 精确 Decimal，规范化十进制表示最多 12 位小数。

换算流程固定为：

1. 将 Expense original total 换算一次为 base total。
2. 使用 half-up 舍入得到 base minor total。
3. Payment 和 Share 分别按其 original 比例计算 base 配额。
4. 尾差按 ActivityMember UUID 的字节稳定升序逐个分配。
5. Ledger 只读取已固化的 base facts，不重新换算历史汇率。

### 5.5 幂等、删除与并发

- Expense 和 Settlement 的 `client_mutation_id` 均必填。
- 唯一键至少包含发起用户与 client mutation ID，重复请求返回首次成功的资源事实。
- Expense 使用 `deleted_at` 软删除；删除后不进入权威 Ledger。
- Settlement 删除语义固定为 `VOID`，保留事实、操作者、时间和 Audit。
- 每个可更新资源具有递增 `version BIGINT`，HTTP 表示为十进制字符串。
- Activity 具有递增 `revision BIGINT`，HTTP 表示为十进制字符串。
- 同一应用事务无论写入多少资源，Activity revision 最多增加一次。
- version 不匹配返回 `409 VERSION_CONFLICT`，禁止静默覆盖。

## 6. Domain 规则

### 6.1 Currency 与 Money

- Currency 由受支持 ISO 4217 清单验证，并携带 minor-unit exponent。
- Money 只允许同币种加减与比较。
- 字符串到 minor units 的解析必须拒绝指数超限、符号错误和范围溢出。
- 格式化允许在 TypeScript 中完成，但正式解析和保存由 Rust 重验。

### 6.2 Splitting

支持四种分摊：

- `EQUAL`：按成员 UUID 稳定顺序分配最小单位尾差。
- `EXACT`：各成员输入金额之和必须等于 Expense original total。
- `PERCENTAGE`：精确百分比之和必须等于 100%，再确定性分配尾差。
- `WEIGHT`：权重必须为正，按权重比例确定性分配尾差。

所有模式输出 original shares，再统一派生并固化 base shares。输入顺序不得影响结果。

### 6.3 Ledger 与 Balance

Ledger 只消费未删除 Expense 的 base payments/base shares 与非 VOID Settlement：

```text
member net = paid base - owed base + settlement sent - settlement received
```

每个活动所有成员 net 之和必须为零。任何不守恒事实均视为数据完整性错误，不由 UI 修补。

### 6.4 Recommendation

推荐算法每轮优先匹配绝对余额最大的债务人与债权人，余额相同时按 ActivityMember UUID 字节升序决胜。目标是清零且可重复，不承诺精确全局最少转账。零余额成员不产生建议。

### 6.5 Permission Policy

权限策略是纯 Domain 决策，输入为 Actor、ActivityMember、资源所有权和生命周期，输出 Allow 或稳定拒绝原因。HTTP 层不得用 UI 传入的权限布尔值授权。

## 7. Application 事务边界

每个写用例遵循固定顺序：

```text
解析并验证 DTO
-> 加载 Actor / Activity / Resource
-> 权限与生命周期检查
-> version / idempotency 检查
-> Domain 计算
-> 单事务写事实
-> 写 Audit
-> activity revision 至多 +1
-> 写 Phase 2 notification outbox/fact
-> commit
```

事务失败必须回滚资源、子表、Audit 和 Revision。幂等 replay 不重复 Audit、Revision 或 Notification。

## 8. 认证与会话

### 8.1 用户名与密码

用户名创建与登录统一执行：NFKC、trim、lowercase，然后只允许 ASCII `a-z0-9._-`，长度 3–32。

密码保留原始 UTF-8，不做 normalization，长度 8–128 字符。使用 Argon2id：

```text
m = 65536 KiB
t = 3
p = 1
```

参数升级时，成功登录可在事务内 rehash。

### 8.2 Session

- token 使用 32-byte CSPRNG，Cookie 保存 base64url 原 token。
- 数据库只保存 token 的 SHA-256 hash。
- idle timeout 为 30 天，absolute timeout 为 90 天。
- `last_seen_at` 最长每 24 小时刷新一次，减少写放大。
- 主动改密撤销其他 Session 并轮换当前 Session。
- Phase 3 管理员重置密码撤销该用户全部 Session。

Cookie 默认属性：`HttpOnly`、`SameSite=Lax`、`Path=/`，生产 HTTPS 使用 `Secure`。退出登录同时使服务端 Session 失效并过期 Cookie。

### 8.3 Bootstrap 与注册

首位用户只能通过：

```text
huddletab bootstrap-user --username <name>
```

密码通过交互输入或明确的受保护输入机制提供，不写入日志。事务内锁定 bootstrap 条件并要求 `users=0`；并发执行只允许一个成功。不存在 HTTP bootstrap。

Phase 1 注册必须携带有效邀请。注册时验证邀请只允许创建账号；加入活动时再次验证邀请的有效期、状态、目标和使用限制。

### 8.4 CSRF 与同源策略

- `/data/app-secret` 是持久化随机密钥；首次启动以受限权限原子创建。
- CSRF token 使用 HMAC 签名并绑定 Session 或 pre-auth context。
- 所有 cookie-authenticated unsafe method 校验 `X-CSRF-Token`。
- 同时校验允许的 Origin 与 `Sec-Fetch-Site`，拒绝明确跨站请求。
- API 只支持同源，不提供通用 CORS。
- 登录等 pre-auth 写请求也必须获得并提交绑定的 CSRF token。

## 9. HTTP Contract

### 9.1 Envelope

成功：

```json
{"data": {}}
```

错误：

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "该内容已被其他成员更新，请查看最新内容后重试。",
    "fieldErrors": {},
    "details": {},
    "requestId": "uuid"
  }
}
```

`requestId` 由入口中间件生成或验证后透传。日志可输出中文上下文，但不得记录密码、Session token、CSRF token 或邀请原 token。

### 9.2 Phase 1 路由

认证：

```text
GET    /api/auth/csrf
POST   /api/auth/login
POST   /api/auth/logout
POST   /api/auth/register
GET    /api/auth/session
PUT    /api/me/password
```

活动、成员与邀请：

```text
GET    /api/activities
POST   /api/activities
GET    /api/activities/{activityId}
PUT    /api/activities/{activityId}
GET    /api/activities/{activityId}/members
POST   /api/activities/{activityId}/members/guests
PUT    /api/activities/{activityId}/members/{memberId}
GET    /api/activities/{activityId}/invitations
POST   /api/activities/{activityId}/invitations
DELETE /api/activities/{activityId}/invitations/{invitationId}
GET    /api/invitations/{token}
POST   /api/invitations/{token}/join
```

账单与账务：

```text
GET    /api/activities/{activityId}/expenses
POST   /api/activities/{activityId}/expenses
GET    /api/activities/{activityId}/expenses/{expenseId}
PUT    /api/activities/{activityId}/expenses/{expenseId}
DELETE /api/activities/{activityId}/expenses/{expenseId}
GET    /api/activities/{activityId}/ledger
GET    /api/activities/{activityId}/settlement-recommendations
GET    /api/activities/{activityId}/settlements
POST   /api/activities/{activityId}/settlements
PUT    /api/activities/{activityId}/settlements/{settlementId}
DELETE /api/activities/{activityId}/settlements/{settlementId}
```

### 9.3 OpenAPI 生成链

```text
Rust DTO + route annotations
-> huddletab openapi --output contracts/openapi.json
-> openapi-typescript
-> frontend/src/api/generated/openapi.ts
-> openapi-fetch client
-> feature adapters
-> TanStack Query hooks
```

组件禁止直接 `fetch`，禁止手写与 OpenAPI 重复的 request/response DTO。生成文件必须可重复生成并由 CI 检查无 diff。

## 10. Frontend 与 PWA

### 10.1 UI 迁移

- 直接迁移 UI primitives、Design Token、视觉资产、Picker、表单和已验收交互。
- 只替换 31 个已识别的 Next coupling：Link、Image、Navigation 与页面装配。
- 桌面和移动响应式结构、亮暗主题、触控尺寸和无障碍语义保持等价。
- 发生 `409` 时保留未保存草稿，提供查看最新事实入口。

### 10.2 状态与 API

- React Router 负责路由和 URL state。
- TanStack Query 负责服务器状态、query key 和失效；组件本地 state 只保存草稿与短暂 UI 状态。
- logout/401 清理当前用户指针和 Query cache。
- TypeScript 仅实现 Money 格式化、Split/Payment 预览和离线预校验。
- Ledger、Balance 和 Recommendation 只展示 Rust 返回的权威结果。

### 10.3 Service Worker

Phase 1 Service Worker 只缓存 SPA shell、hashed assets、icons 和 manifest。匹配规则必须显式排除：

```text
/api/**
Session / CSRF 响应
账务 JSON
邀请预览响应
```

Phase 1 不实现业务离线队列。

### 10.4 Phase 2 IndexedDB

- 数据按 user ID 与 activity ID 隔离。
- 只持久化 Snapshot 和 Expense Create Queue，不持久化 TanStack Query cache。
- Snapshot 使用 activity revision 弱 ETag，客户端完整原子替换。
- 离线只允许 Expense Create，前台串行同步。
- 网络错误与 5xx 使用有界重试；业务拒绝转为 `REJECTED` 并保留原输入。
- Pending Expense 可显示在流水，但不进入权威 Ledger/Balance。
- logout/401 不删除 pending queue；只有显式“清除此设备本地数据”才删除 IndexedDB。

## 11. Golden Tests

`golden/` 保存不依赖语言实现的 JSON 向量，覆盖：

- Currency exponent 与合法/非法金额字符串。
- Decimal rate normalization、half-up 舍入与溢出边界。
- EQUAL、EXACT、PERCENTAGE、WEIGHT 四种分摊。
- 多人付款、外币固化、尾差 UUID 顺序。
- Ledger 零和、Settlement 应用和 Recommendation 确定性。

Rust 必须执行全部权威案例；TypeScript 执行其保留的格式化、预览和预校验子集。向量必须包含期望值，不能通过调用另一端实现动态生成期望结果。

## 12. 部署与运维

最终 Compose 只有 `app` 与 `postgres`：

- Node 只存在于 Docker build stage，用于生成前端静态产物。
- Rust build stage 编译单一 release binary。
- runtime stage 只复制 binary、静态产物、必要 CA/时区数据和空 `/data` 目录。
- runtime 使用固定非 root UID/GID。
- `/data/app-secret`、上传和后续备份位于 app bind mount；PostgreSQL 位于独立 bind mount。
- healthcheck 使用 Rust binary 或可用的轻量 HTTP 工具，不依赖 Node。

升级流程先备份、拉取镜像、运行向前兼容 migration、启动应用、验证 health。Phase 1 不提供自动 downgrade migration。

## 13. 验收矩阵

- Rust unit/property：Money、rate、splitting、守恒、Ledger 零和、Recommendation 确定性。
- PostgreSQL integration：复合外键、Owner 唯一、回滚、幂等 replay、Audit/Revision 单次副作用、version conflict。
- Auth/API：bootstrap 竞争、Argon2 rehash、Session idle/absolute、改密轮换、CSRF、Origin、限流、Cookie、JSON 404/405。
- Frontend：Router、query key/invalidation、generated contract、表单草稿保留、现有 UI 与响应式测试。
- Phase 1 E2E：单币种均摊；外币、多付款、非均摊；部分 Settlement 到归零；Expense/Settlement 双客户端冲突。
- Phase 2 E2E：断网刷新、响应丢失幂等、REJECTED 保留、Snapshot ETag、PWA 更新不丢 pending。
- 浏览器：Chromium 完整矩阵、Playwright WebKit 关键回归、每个 RC 真机 iPhone Safari/Home Screen 人工验收。
- 发布：实际检查生产镜像不存在 Node.js、Next.js、Better Auth 和 Drizzle runtime。

## 14. 风险与控制

- **账务双实现漂移：** Rust 为唯一权威；TypeScript 只保留预览子集，并共用 golden vectors。
- **复合外键遗漏：** 所有账务成员引用纳入 PostgreSQL integration tests。
- **幂等重复副作用：** 资源写入、Audit、Revision 和 Notification 在同一事务验证 replay。
- **CSRF 密钥轮换导致 token 失效：** app-secret 持久化，缺失时才原子创建。
- **前端迁移视觉回归：** 复用原组件与资产，逐路由截图对比和移动端检查。
- **过早删除旧基础：** 新骨架独立 build、serve、migration、OpenAPI 和 Compose 全部通过后才删除旧运行基础。

## 15. 冻结决策

修改以下任一边界必须先更新本文并评审：金额表示、汇率定义、尾差顺序、账务身份、复合外键、幂等键、删除语义、version/revision、认证参数、CSRF 绑定、同源策略、OpenAPI 生成链、离线范围和最终运行镜像。
