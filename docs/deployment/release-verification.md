# 最终 Release Verification

本清单只适用于 Rust/Axum 新栈的 `0.0.3` 候选。它不会创建 Git tag，也不会推送 GHCR；正式发布必须在自动化门禁和真机验收都通过后，再创建 `v0.0.3`。

## 自动化门禁

在干净 Git 工作区执行：

```powershell
pwsh -NoProfile -File scripts/verify-release.ps1
```

入口固定使用 `APP_VERSION=0.0.3`，会运行 Rust fmt/Clippy、全部单元与 PostgreSQL 测试、OpenAPI/client 漂移检查、Frontend 测试/typecheck/build、数据目录安全测试，以及完整的 Compose/Playwright 矩阵。它只使用一次性 PostgreSQL 和独立 Compose project，失败和成功都会清理临时资源；HTML 报告保留在 `frontend/artifacts/playwright-report/index.html`。

自动化矩阵包含 Chromium Desktop `1440x1000`、Chromium Mobile `390x844` 的核心、Phase 2、附件、通知/所有权、Task 29、Task 30、Task 31 项目，以及 WebKit smoke。还会检查 fresh migration、SPA 深链、API JSON 404/405、安全响应头、PWA 控制、非 root UID、运行镜像不含 Node/Next/Better Auth/Drizzle、重启持久性和中文冷启动错误。

## iPhone Safari/Home Screen 人工验收

自动化门禁通过后，在 HTTPS 候选环境中使用真实 iPhone Safari：

1. 打开公开 HTTPS 地址，确认登录、活动列表和活动主导航仅显示“流水 / 结算”。
2. 通过 Safari“添加到主屏幕”，从 Home Screen 启动，确认 standalone 页面、图标、标题和返回行为正常。
3. 在线打开活动并创建一笔带图片的 Expense；确认图片缩略图、删除按钮和原图预览与桌面行为一致。
4. 在已缓存活动页面后断网刷新，确认流水、账单详情、结算、Ledger/Recommendation 和离线标记仍可读取；不允许离线管理、Settlement 或其他网络写入。
5. 断网创建 Expense 并附图，刷新后确认本地记录仍在；恢复网络后确认服务端只产生一笔事实，附件可读取。
6. 在有未完成队列时触发 PWA 更新，确认显示“有新版本可用，完成同步后更新”且不会立即激活；同步完成后再次更新，确认 reload 后 IndexedDB 与附件 Blob 仍存在。
7. 注销、Session 失效或切换账号后，确认不会恢复前一个用户的离线数据。
8. 检查桌面与窄屏页面没有横向溢出，失败表单草稿和 REJECTED 修正行为保持不变。

记录设备 iOS 版本、Safari 版本、候选镜像摘要、访问地址、测试日期和失败截图；不要记录密码、Session Cookie、邀请 token 或数据库连接串。

## 发布边界

只有自动化门禁和真机验收均有记录后，才允许创建 `v0.0.3` tag。GHCR workflow 仅接受语义版本 tag，并会发布固定版本标签和 `latest`。超过 Activity 恢复窗口的物理清理 Job 属于发布后的独立任务；当前只隐藏并禁止恢复，不会物理删除记录。
