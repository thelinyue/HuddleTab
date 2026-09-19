# PostgreSQL 集成测试

需要将 `TEST_DATABASE_URL` 指向可丢弃的 PostgreSQL 测试数据库，然后运行：

```powershell
$env:TEST_DATABASE_URL = "postgresql://<test-user>:<test-password>@127.0.0.1:5432/<test-database>"
cargo test --all-targets -- --include-ignored --test-threads=1
```

集成测试会共享同一个测试数据库，并在测试之间清理数据；必须使用
`--test-threads=1`，否则并行 `TRUNCATE` 可能产生死锁或测试数据互相污染。
