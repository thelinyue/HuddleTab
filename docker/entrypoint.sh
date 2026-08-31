#!/bin/sh
set -eu

printf '%s\n' '正在执行数据库迁移……'
node src/server/db/migrate.ts
printf '%s\n' '正在启动应用服务器……'
exec node server.js
