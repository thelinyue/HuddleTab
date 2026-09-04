# HuddleTab Phase 3 Task 30 设计：初始化引导、Sharing Summary 与 CSV 收口

日期：2026-09-03

## 1. 范围与基线

本任务只完成网页初始化、Sharing Summary 扩展和 CSV 安全收口，不进入 Task 31 或正式发布。编码前已对照本地 `v0.0.2` 运行环境 `http://127.0.0.1:5682` 及远程对应源码：新栈继续采用独立页面/紧凑卡片、现有 Sheet 与按钮层级；分享仍从结算上下文进入，不新增活动主导航。

`v0.0.2` 的初始化页包含网页凭据表单；本次修正恢复同样的字段顺序和自动登录交互。首位管理员通过同源网页 `/api/setup` 创建，不生成 Setup Token；初始化完成前必须限制网络访问。

## 2. 初始化状态与页面守卫

`GET /api/setup/status` 是公开只读接口，直接以 `users` 是否为空判断 `setupRequired`。查询失败时返回现有错误 envelope；成功响应设置 `Cache-Control: no-store`。路由不经过 Session/IndexedDB/Service Worker 缓存。

React Router 的 `SetupGuard` 在产品树外层读取该状态：空库时除 `/setup` 外的登录、注册、邀请、活动和所有深链统一重定向 `/setup`；已初始化访问 `/setup` 重定向 `/login`；状态读取失败停在中文错误页并提供重试。`/setup` 只展示并可复制：

```text
打开实例的 `/setup` 页面填写管理员昵称、用户名、密码和确认密码。
```

提交成功后页面自动登录并进入活动列表；服务端失败时保留表单草稿，初始化状态仍不写入 IndexedDB 或 Service Worker。

## 3. Sharing Summary 一致性

摘要和 CSV 复用现有 `REPEATABLE READ READ ONLY`、成员授权事务。事务内一次读取活动、revision、未删除 Expense、付款/分摊、Settlement 和成员，再计算余额与推荐转账；因此扩展统计不会与账务事实混合。

摘要增加：

- `startDate`、可空 `endDate`
- `expenseCount`、`participatingMemberCount`
- `averageExpenseMinor`
- 按币种排序的 `originalCurrencyTotals`
- 按分类排序的 `categoryTotals`

所有金额继续是最小单位十进制字符串；平均金额使用整数最小单位确定性四舍五入，不经过浮点。响应保留 `Cache-Control: private, no-store`，不含账号资料、附件、邀请、通知、Audit 或 token。

前端在现有结算分享页增加活动概览、复制摘要和系统分享。`navigator.share` 不可用时回退复制；用户取消分享不报错，真实失败显示中文错误并保留页面。PNG 仍由既有 800px、2 倍像素卡导出，文件名保持 `huddletab-settlement-summary.png`。

## 4. CSV 安全边界

`GET /api/activities/{activity_id}/export.csv` 保持原路径、固定中文列、UTF-8 BOM、CRLF、全字段双引号、部署时区和稳定成员顺序。单元格在去除前置空白后若以 `= + - @` 开头，则前置单引号；双引号、逗号、换行按 CSV 规则转义。只导出未删除 Expense，拒绝未授权、离开成员、已删除活动和过期 Session；不泄漏私有字段。

## 5. 验收边界

`Task30Only` 是现有 Phase 1E runner 的固定模式，只运行 Chromium Desktop `1440x1000` 与 Mobile `390x844` 的初始化/摘要/CSV 流程，并保留 fresh migration、网页表单初始化、SPA 深链、非 root、运行镜像无 Node、重启持久性、中文冷启动错误、凭据脱敏和限定清理。它不接受任意 Playwright 或 Compose 参数。

本任务完成后结论严格为：“Phase 3 Task 30 完成，可以进入 Task 31。”Task 31、真机 iPhone Safari/Home Screen PWA、最终 Release Verification 和正式 `v0.0.3` 镜像发布仍未完成。
