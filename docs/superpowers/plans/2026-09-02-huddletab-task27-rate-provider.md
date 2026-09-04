# HuddleTab Task 27 Rate Provider 实施记录

实现由 application `ExchangeRateProvider/ExchangeRateCache` ports、Frankfurter reqwest adapter、PostgreSQL cache repository、授权 HTTP handler 和 Expense 汇率快照组成。确定性测试使用 fake Provider 与本地 Axum 响应器，不依赖公网；公网只做非阻断结构 smoke。

数据库新增 `exchange_rate_cache` 唯一键和 Expense 自动来源元数据约束。OpenAPI/client 发布新 GET 合同和扩展后的 Expense DTO。前端继续通过生成 client，仅在用户点击时查询；成功整体写入 rate/source/date/provider，任何手工修改都清空自动元数据。

验收包括 Provider 精确解析、超时、缓存优先和七天降级；真实 PostgreSQL 的缓存唯一约束、Expense create/update/replay、Snapshot 与 schema 约束；前端 adapter、显式交互、失败保留草稿、全量单测、typecheck/build，以及 Rust fmt、Clippy 和 OpenAPI 可重复生成。

完成结论只能是：“Task 27 Rate Provider 完成，可以继续其余通知事件。”
