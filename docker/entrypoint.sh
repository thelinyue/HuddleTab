#!/bin/sh
set -eu

printf '%s\n' '正在执行数据库迁移……'
npm run db:migrate
printf '%s\n' '正在检查首次初始化状态……'
exec npm run start:container
