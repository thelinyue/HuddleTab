#!/bin/sh
set -eu

# 运行时数据只写入 bind mount，确保镜像升级和容器重建不会丢失应用状态。
data_dir="${DATA_DIR:-/data}"
secret_file="$data_dir/config/better-auth-secret"

mkdir -p "$data_dir/uploads" "$data_dir/backups" "$data_dir/config"

# 显式提供密钥时完全交由部署者负责；否则首次启动生成并持久化，后续启动复用同一文件。
if [ -z "${BETTER_AUTH_SECRET:-}" ]; then
  if [ ! -s "$secret_file" ]; then
    temporary_secret_file="$secret_file.tmp"
    umask 077
    node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('base64url'))" > "$temporary_secret_file"
    chmod 600 "$temporary_secret_file"
    mv "$temporary_secret_file" "$secret_file"
    echo "未设置 BETTER_AUTH_SECRET，已在持久化目录自动生成应用密钥；密钥内容不会输出到日志。"
  fi

  BETTER_AUTH_SECRET="$(cat "$secret_file")"
  export BETTER_AUTH_SECRET
fi

# 允许完整连接串直接覆盖；缺失时按 postgres.js 的实际解析语义用标准 URL API 安全构建。
if [ -z "${DATABASE_URL:-}" ]; then
  DATABASE_URL="$(node -e '
    const url = new URL("postgresql://postgres");
    const username = process.env.POSTGRES_USER ?? "huddletab";
    const password = process.env.POSTGRES_PASSWORD ?? "huddletab-local-db-password";
    const database = process.env.POSTGRES_DB ?? "huddletab";

    url.hostname = process.env.POSTGRES_HOST ?? "postgres";
    url.port = process.env.POSTGRES_PORT ?? "5432";

    // postgres.js 会对用户名和密码 decodeURIComponent 一次，预编码可完整保留字面百分号。
    url.username = encodeURIComponent(username);
    url.password = encodeURIComponent(password);

    // postgres.js 不解码 pathname；查询参数会由 URLSearchParams 解码并覆盖实际启动数据库名。
    url.pathname = "/";
    url.searchParams.set("database", database);
    process.stdout.write(url.toString());
  ')"
  export DATABASE_URL
fi

npm run db:migrate
exec "$@"
