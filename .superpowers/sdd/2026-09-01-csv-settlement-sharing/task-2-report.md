# Task 2 Report: React 结算摘要、PNG 导出与 CSV 入口

## 实现

- 新增 `frontend/src/features/sharing/`：generated `ActivitySummaryData` 仅在 adapter 内被消费；adapter 用 TanStack Query 提供展示模型。展示模型负责金额方向、成员姓名与空账本/已结清/待转账状态。
- 新增纯 `ShareSummaryCard`、独立分享页及 PNG 导出 helper。导出 helper 等待 `document.fonts.ready` 和卡片图片完成，再只传入 `#share-summary-card` 给 `html-to-image`；固定逻辑宽度 800、`pixelRatio: 2`、下载名 `huddletab-settlement-summary.png`。
- 安装精确依赖 `html-to-image@1.11.13`。分享页使用已有本地 `public/share/settlement-cover-beijing.png`，支持长文本换行、空账本、全部结清、加载、可恢复读取失败和导出失败提示。
- 注册受 Session 保护、`React.lazy` 的 `/share-summary/:activityId`。该页不嵌入 ActivityWorkspace，因此不显示活动页头或产品导航；PWA 更新提示也按路径抑制。
- Settlement 中增加“生成分享摘要”，ActivityManagement Overlay 中增加“数据导出 / 导出 CSV”。CSV 是相对同源原生 `<a>`，未由组件 fetch。
- 响应式样式将可见预览限制在 `max 800px` / `width: 100%`，将固定 800px 导出卡放在离屏固定画布。Playwright 的 390px 检查无水平溢出。

## RED 证据

在实现前执行：

```powershell
npm --prefix frontend run test:unit -- src/features/sharing/adapter.test.ts src/features/sharing/card.test.tsx src/features/sharing/image-export.test.ts src/features/accounting/pages-ui.test.tsx src/features/activities/pages.test.tsx src/app/router.test.tsx
```

结果退出码 `1`：`adapter.ts`、`card.tsx`、`image-export.ts` 尚不存在；结算入口与 CSV 原生链接缺失；`/share-summary/activity-1` 进入 NotFound 且渲染 PWA 提示。全部为缺失功能导致的预期 RED。

## GREEN 与验证

```powershell
npm --prefix frontend run test:unit -- src/features/sharing/adapter.test.ts src/features/sharing/card.test.tsx src/features/sharing/image-export.test.ts src/features/sharing/page.test.tsx src/features/accounting/pages-ui.test.tsx src/features/activities/pages.test.tsx src/app/router.test.tsx
```

结果：`7 passed, 40 passed`。

```powershell
npm --prefix frontend run test:unit
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

结果：Vitest `13 passed, 60 passed`；typecheck 退出码 `0`；生产构建退出码 `0`，分享页为独立 `page-*.js` chunk。

使用 Playwright 拦截同源 API 后验证浏览器：

- `1440x1000`：预览宽 `800`，导出卡宽 `800`，`horizontalOverflow: false`。
- `390x844`：预览宽 `358`，导出卡宽 `800`，`horizontalOverflow: false`。
- 真实点击“下载 PNG”：文件名 `huddletab-settlement-summary.png`，解析 PNG IHDR 得到宽 `1600`、高 `1018`，符合逻辑 800px、像素比 2。

## 文件变更

- 新增：`frontend/src/features/sharing/{adapter,card,image-export,page}.{ts,tsx}` 及其聚焦测试。
- 修改：`frontend/package.json`、`frontend/package-lock.json`、query keys、路由、Settlement、ActivityManagement、全局样式及现有路由/入口测试。

## 自检

- 生成 DTO 未泄漏到组件；卡片只消费 feature 展示模型。
- ActivityWorkspace 导航仍只有“流水 / 结算”。
- CSV 仍是同源原生链接；无 Web Share API、匿名路由、服务端 PNG 或旧 Next.js 参考代码改动。
- 导出固定捕获唯一 `#share-summary-card`，等待字体/图片，使用 2 倍像素比；移动端不把离屏 800px 画布放入正常布局。
- 已运行 `git diff --check`，无空白错误。现有无关未跟踪目录 `.cargo-target-verify-task1/` 未修改、未加入提交。

## 关注项

- 无功能阻塞。浏览器 API 使用了受控 mock 响应以验证前端独立页面和下载行为；端到端权限和真实服务端数据合同由 Task 1/Task 3 覆盖。
