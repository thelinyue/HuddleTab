# HuddleTab MCP 连接

HuddleTab 提供远程 Streamable HTTP MCP 服务，地址为部署站点的 `/mcp`。客户端使用个人访问令牌发送：

此连接使用 Bearer PAT，不启用 OAuth。

```text
Authorization: Bearer ht_mcp_...
```

客户端只需把站点完整地址和这个请求头填入 Streamable HTTP 连接配置：

```json
{
  "url": "https://your-huddletab.example/mcp",
  "headers": { "Authorization": "Bearer ht_mcp_..." }
}
```

令牌在“我的 → MCP 连接”中创建。完整令牌只在创建成功的当前响应显示一次；服务端只保存 SHA-256 摘要。令牌可设置 30 天、90 天、365 天、自定义到期时间或永不过期，也可以随时撤销。

## 权限

- `READ`：读取当前用户有权限访问的活动、成员、账单、Ledger、结算记录、摘要和结算建议。
- `EXPENSES_CREATE`：包含读取权限，并允许调用 `create_expense` 直接新增正式账单。

`create_expense` 不是草稿流程：成功后账单立即写入，不需要打开网页或二次确认。调用必须提供稳定的 `clientMutationId`（UUID）；网络重试会返回同一笔账单的幂等重放结果。

当前 MCP 写入面只支持新增账单，不支持附件、账单更新/删除或任何结算写入。

## 提供的 MCP 能力

工具包括 `list_activities`、`get_activity`、`get_activity_summary`、`list_expenses`、`get_expense`、`list_settlements`、`get_settlement`、`get_ledger`、`get_settlement_recommendations` 和 `create_expense`。结算建议是只读的，不会创建或修改结算记录。

资源使用 `huddletab://activities...` URI，可读取活动、成员、账单、结算、Ledger、建议和摘要 JSON。提示词包括 `record_expense`、`review_activity_finances` 和 `plan_settlement`；其中 `record_expense` 会指导客户端补齐字段后直接调用 `create_expense`。

令牌权限仍受 HuddleTab 当前活动成员权限约束；令牌本身不会扩大用户可见范围。
