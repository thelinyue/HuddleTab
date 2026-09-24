# 活动详情 A / B 交互原型

独立浏览器原型，用于比较旅行记账和结算的信息架构，不接入正式页面或服务器。

从仓库根目录启动：

```powershell
node frontend/prototypes/activity-review/serve.mjs
```

打开 <http://127.0.0.1:4288>。桌面并排预览 A / B，可切换三条任务、重置两版数据、开启大字体；手机尺寸可使用“单独打开”入口。端口被占用时，通过 `ACTIVITY_REVIEW_PORT` 指定独立端口。

运行验证和生成报告（依赖项目已有 Playwright 浏览器）：

```powershell
node frontend/prototypes/activity-review/verify.mjs
node frontend/prototypes/activity-review/report.mjs
```

验证会检查本地服务器身份。图像、原始测量和报告生成在仓库的 `artifacts/activity-review/`，预览运行时可访问 <http://127.0.0.1:4288/evidence/report.html>。源码与正式构建分离，无生产 API、数据库或依赖变更。

比较口径：同一组6人、5天、30笔账单；每条任务重置数据；每个版本、视口、任务预热一次并记录三次。原生下拉框选择单列计数，脚本时间不是人的阅读或操作时间。浏览器配置模拟手机视口，不等于真机验收。

原型实现范围：新增消费、搜索、按日期筛选、只读账单详情、个人/全员余额、推荐付款、活动整体部分付款、手动补记及历史记录。编辑、附件、AI、按账单归属、结算方案切换、分享、真实管理、浏览器历史栈与离线同步不属于本次原型。

`model.js` 的本地整数金额模型仅用于交互自洽，正式业务继续使用 Rust Ledger 和 Recommendation。
