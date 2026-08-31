# Shared Accounting Golden Vectors

本目录保存 Rust 权威 Domain 与 TypeScript 预览逻辑共同读取的 JSON 测试向量。

约束：

- 每个向量必须提交输入和明确期望输出，禁止从另一语言实现动态生成期望值。
- UUID 使用固定测试值，尾差按 UUID 字节升序验证。
- 金额、汇率和权重全部使用十进制字符串，避免 JSON number 精度问题。
- Rust 执行全部 Currency、Rate、Splitting、Ledger 与 Recommendation 案例。
- TypeScript 只执行格式化、Split/Payment 预览和离线预校验子集。

Phase 1B 添加 `currency.json`、`exchange-rates.json`、`splitting.json` 与 `accounting.json`。
