# HuddleTab 0.0.3 全站 UI 还原与 Apple Design 实施记录

## 已实施

1. 引入 v0.0.2 令牌与公共壳：认证插画卡、品牌块、图标输入框/密码显示、分隔式切换、800px 产品边界和半透明底部导航。
2. Activity 首页加入创建/加入子视图、持续天数、历史活动折叠及双按钮空状态；Workspace 页头按旧版显示天数、成员数和状态。
3. 通知页恢复五段分段筛选、未读/今天/昨天/更早分组、未读圆点、旧版类型图标与摘要；保留审批内联操作和安全深链。
4. Overlay 与账务 Sheet 增加标题栏拖拽、速度投影、回弹、背景滚动锁定、焦点循环/返回及 reduced-motion/transparency/contrast 适配；桌面 Dialog 收窄为约 384px、根视图标题居中；记账表单加入“更多设置”层级，破坏性操作统一使用确认弹层。
5. 新增固定 `UiParityOnly` runner 模式及 Chromium Desktop `1440x1000`、Mobile `390x844` 项目；不接受测试路径、Compose 文件或任意 Playwright 参数。

## 验证

```powershell
npm --prefix frontend run test:unit
npm --prefix frontend run typecheck
npm --prefix frontend run build
pwsh -NoProfile -File frontend/e2e/support/run-phase1e-safety.test.ps1
git diff --check
```

UI 对照浏览器入口：

```powershell
& ./frontend/e2e/run-phase1e.ps1 -UiParityOnly
```

该入口会创建独立临时 Compose 并在 finally 清理；报告保留在 `frontend/artifacts/playwright-report`。本轮不创建 `v0.0.3` tag、不发布 GHCR，也不宣称正式发布完成。
