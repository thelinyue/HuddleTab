use huddletab_server::infrastructure::database::connect_and_migrate;

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn fresh_database_migrates_and_replay_is_idempotent() {
    let database_url = std::env::var("TEST_DATABASE_URL")
        .expect("运行 migration 集成测试前必须设置 TEST_DATABASE_URL");

    let pool = connect_and_migrate(&database_url)
        .await
        .expect("空数据库应可执行 migration");
    drop(pool);

    let replayed_pool = connect_and_migrate(&database_url)
        .await
        .expect("重复启动不应重复执行已记录 migration");
    let applied_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations")
        .fetch_one(&replayed_pool)
        .await
        .expect("应可读取 SQLx migration 记录");

    assert_eq!(applied_count, 2);
}
