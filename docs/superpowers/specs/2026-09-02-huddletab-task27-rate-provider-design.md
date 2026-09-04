# HuddleTab Task 27 Rate Provider 设计

本切片为 Expense 提供显式请求的日参考汇率，不自动覆盖用户输入。Rust 服务端固定访问 Frankfurter v2，三秒超时；查询先读精确日期 PostgreSQL 缓存，上游失败时只回退到请求日期之前七天内的最近缓存。

`GET /api/activities/{activity_id}/exchange-rate?from=JPY&date=2026-08-30` 在 Session、ACTIVE 成员和 Expense 可写生命周期授权后读取 Activity 主币。成功返回十进制字符串、来源 `PROVIDER/CACHE`、`FRANKFURTER` 与实际参考日期；非法请求返回 `422 INVALID_EXCHANGE_RATE_QUERY`，无可用数据返回 `503 EXCHANGE_RATE_UNAVAILABLE`。Provider JSON 数值先保留为十进制文本，再经既有 `ExchangeRate` 校验，不参与浮点账务计算。

Expense 将 `IDENTITY/MANUAL/PROVIDER/CACHE`、精确 rate、可选参考日期和 Provider 一起保存。数据库约束强制合法组合；Create、Update、幂等 replay、Snapshot、CSV 读取和离线 Queue 使用同一快照，Ledger 永不重新获取历史汇率。

UI 编码前后均对照本地实际和远程源码 `v0.0.2`。字段顺序、表单密度、手工输入和失败草稿保持不变，仅在汇率输入同层增加次级“获取参考汇率”按钮。币种变化清空旧值；日期变化清除自动来源；用户编辑建议值后立即转为 MANUAL。离线或失败只提示手工输入。

本切片不包含其他通知事件、Task 28、Provider 配置后台、自动刷新、singleflight、IndexedDB v2、tag 或发布。
