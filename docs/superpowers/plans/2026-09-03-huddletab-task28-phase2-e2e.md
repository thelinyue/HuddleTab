# HuddleTab Task 28 Phase 2 收口实施记录

> 历史记录说明：本文件早期浏览器 runner 使用 stdin bootstrap；2026-09-04 已改为 `/setup` 网页管理员初始化，旧命令不能作为当前操作指引或验收证据。

## 已实现

- 当前标签页 Session 网络错误回退与 401 清除边界。
- Activity Snapshot 在线条件刷新、断网缓存读取和网络恢复刷新；离线流水、账单详情、结算使用完整 Snapshot，pending 不计入权威统计。
- 离线只保留 Expense Create 本地队列；成员/邀请/审批/活动管理与账务网络写入口在离线时关闭。
- REJECTED 账单完整回填、图片缩略图/原图预览、原 mutation/clientAttachment id 重提、原子替换和确认丢弃。
- PWA waiting worker 更新闸门：当前用户任一未完成 mutation/attachment 都阻止激活，点击前二次读取 IndexedDB。
- `Phase2Only` 固定 runner 与 `chromium-phase2-desktop/mobile` 项目；不接受任意 Playwright 参数。

## 验证命令

```powershell
npm --prefix frontend run test:unit
npm --prefix frontend run typecheck
npm --prefix frontend run build
& ./frontend/e2e/support/run-phase1e-safety.test.ps1
& ./frontend/e2e/run-phase1e.ps1 -Phase2Only
git diff --check
```

Frontend 全量为 29 个测试文件、174 个测试通过；PWA 更新组件、策略、Session、Snapshot、队列和 REJECTED 专项均通过。production build 生成 manifest 与 Service Worker；runner 安全专项和 `git diff --check` 通过。

最终 `Phase2Only` 单一 Compose 入口通过 7 个浏览器测试（Chromium Phase 2 Desktop/Mobile、Attachment Desktop/Mobile、Notification/Ownership Desktop/Mobile、WebKit smoke），单 worker、零重试。通过项包括：在线 Snapshot ETag 200/304、Service Worker 控制页面、断网刷新读取流水/缓存、断网 Expense 入队与恢复联网单笔同步、服务端提交后响应丢失的同 mutation 重放、422 REJECTED 修正、附件/审批/所有权关键流程、活动导航仅“流水 / 结算”、无横向溢出、fresh migration、stdin bootstrap、SPA 深链、非 root/无 Node runtime、app 与 PostgreSQL 重启持久性、中文冷启动错误、artifact 脱敏和 finally 清理。临时 Compose project 与 `/tmp/huddletab-phase1e-*` 目录均已删除；报告保留在 `frontend/artifacts/playwright-report/index.html`。

## 未完成

Task 28 完成后仅表示 Phase 2 exit gate 通过，可以进入 Phase 3。Tasks 29–31、iPhone Safari/Home Screen PWA 真机人工验收、最终 Release Verification、后台清理 Job，以及正式 `v0.0.3`/`v0.0.3` 镜像发布仍未完成。本轮未创建 tag、未推送 GHCR，也未宣称达到正式发布状态。
