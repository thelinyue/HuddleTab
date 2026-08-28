# HuddleTab Product UI Refresh Implementation Plan

**Goal:** 以 2026-08-27 用户提供的最新移动端 UI 图为唯一视觉基准，重构产品主路径 UI，同时保留现有路由、权限、账务和离线契约。

## Global Constraints

- 保留“活动 / 通知 / 我的”一级导航与“流水 / 结算 / 成员 / 更多”活动内导航。
- 不增加数据库图片字段、上传流程、附件权限或新的桌面信息架构。
- Mobile `<=480px` 全宽单列；Tablet `481-767px` 单列加宽；Desktop `>=768px` 居中，最大宽度 `720-840px`。
- 共享原语仅限 `AppHeader`、`MoneyAmount`、`MemberAvatar`、`ActivityCover`、`StatusBadge`、`EmptyState`、`SyncStatus`、通用 Overlay 外观和跨页一致的列表动效。
- 关键类和复杂实现使用中文注释；错误与日志使用普通用户可理解的中文。
- GSAP 只动画 transform/opacity；必须清理并支持 `prefers-reduced-motion`。
- 每个行为变更先写失败测试，保持既有 UI、权限、离线和账务测试通过。

## Tasks

### Task 1: Visual Foundation

更新视觉 Token，增加稳定封面/头像、金额、标题、空状态、同步状态和列表动效原语，并加入 6 个本地 4:3 封面 preset。

### Task 2: App Shell And Navigation

重构 App Shell、全局导航、活动内导航、Button/Input/Tabs/Toast/Dialog/Sheet 外观。

### Task 3: Activity Home And Feed

重构活动列表与流水：摘要、生命周期、封面、日期/成员/状态、统计区、分组流水和浮动记账入口。

### Task 4: Quick Expense And Splitting

将快速记账重排为金额优先流程，并在同一 Overlay 内提供分摊设置步骤，保留高级字段和离线行为。

### Task 5: Detail Settlement And Members

重构消费详情、结算和成员：净额明细、总览/记录页签、成员/已离开分组，不改变权限规则。

### Task 6: Notifications Profile And States

重构通知、我的、更多、活动摘要与状态反馈；通知筛选和全部已读复用现有端点。

### Task 7: Visual Verification

使用 390x844、700x900、1440x1000 视口做逐页视觉检查，验证亮暗主题、Reduced Motion、焦点、安全区和无横向滚动。

### Task 8: Final Verification

运行 UI 单测、Lint、TypeScript、Build 和核心 Playwright 验证。

## Interface Changes

- `ExpenseFeedSummaryDto` 增加现有摘要端点已经返回的 `startDate`、`endDate`、`memberCount`。
- `QuickExpenseContextDto.activity` 和对应服务返回增加 `status: "ACTIVE" | "ENDED" | "ARCHIVED"`。
- 不修改数据库、离线 mutation、账务算法和附件 API。
