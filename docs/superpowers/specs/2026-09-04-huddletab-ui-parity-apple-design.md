# HuddleTab 0.0.3 全站 UI 还原与 Apple Design 交互说明

## 基线

本轮以远程 `v0.0.2`（提交 `2f1fad2f3411cc7c448fbc055fb81d4a96fd1dfa`）及本地 `5682` 页面为只读基线。公共认证页保留插画与重叠白色表单面，产品页使用 800px 单列边界、浅色连续 surface、底部三项导航；活动工作台主导航严格只有“流水 / 结算”。

桌面端管理、编辑和快速操作沿用旧版约 384px 的 Dialog 宽度；根视图标题居中，带内部返回路径的子视图使用左侧返回和右侧关闭。移动端同一组件切换为全宽底部 Sheet，不另造一套业务结构。

## 交互收口

- 统一使用现有 React/CSS 设计令牌，按钮和可点击行在 pointer-down 即给出约 `0.97` 的按压反馈，最小触控区为 44px。
- Overlay/Sheet 的标题栏使用 Pointer Events、10px 方向迟滞、Pointer Capture、速度投影和边界 rubber-band；显式关闭、Escape、焦点锁定与关闭后焦点返回始终保留。
- 桌面 Dialog 保持约 384px 的旧版窄宽度；删除、作废和本地丢弃使用同一 AlertDialog 语义，支持取消、Escape 和焦点循环。
- 打开多个面板时通过引用计数锁定背景滚动；`prefers-reduced-motion` 使用短淡入/无弹簧回弹，`prefers-reduced-transparency` 去除模糊，`prefers-contrast` 提高边框和文字对比。
- 活动首页补回旧版持续天数、历史活动折叠和“加入已有活动”；通知使用五段筛选、未读圆点、时间分组、48px 类型图标及受控深链；快速记账保留金额优先布局和“更多设置”入口。

## 范围边界

只调整 Rust 新栈已有页面的结构、样式和交互，不修改 Rust API、数据库、OpenAPI 或旧 Next.js E2E；附件、汇率、离线队列、审批、所有权和管理功能继续沿用现有实现。视觉对照不引入像素 baseline、hash 或 contract freeze。
