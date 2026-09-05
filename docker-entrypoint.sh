#!/bin/sh
set -eu

default_puid=10001
default_pgid=10001

fail() {
  echo "HuddleTab 容器启动失败：$1" >&2
  exit 1
}

normalize_id() {
  variable_name=$1
  value=$2

  case "$value" in
    ''|*[!0-9]*)
      fail "$variable_name 必须是 1 到 2147483647 之间的十进制 UID/GID。"
      ;;
  esac

  while [ "${value#0}" != "$value" ]; do
    value=${value#0}
  done
  [ -n "$value" ] || value=0

  case "$value" in
    0)
      fail "$variable_name 不能为 0；HuddleTab 服务必须以非 root 身份运行。"
      ;;
  esac

  case "${#value}" in
    1|2|3|4|5|6|7|8|9) ;;
    10)
      if [ "$value" -gt 2147483647 ]; then
        fail "$variable_name 必须是 1 到 2147483647 之间的十进制 UID/GID。"
      fi
      ;;
    *)
      fail "$variable_name 必须是 1 到 2147483647 之间的十进制 UID/GID。"
      ;;
  esac

  printf '%s' "$value"
}

puid=$(normalize_id PUID "${PUID:-$default_puid}")
pgid=$(normalize_id PGID "${PGID:-$default_pgid}")

if [ "$(id -u)" -ne 0 ]; then
  fail "入口需要 root 初始化宿主挂载目录权限；请移除 Compose/Docker 的 user 覆盖，让入口完成降权。"
fi

command -v find >/dev/null 2>&1 || fail "运行镜像缺少 find，无法安全修正附件目录权限。"
command -v gosu >/dev/null 2>&1 || fail "运行镜像缺少 gosu，无法降权启动服务。"

if [ -L /data ] || [ ! -d /data ]; then
  fail "/data 必须是实际目录，不能是符号链接。"
fi

# bind mount 会隐藏镜像内的默认属主；这里只处理应用明确拥有的持久化路径。
chown "$puid:$pgid" /data || fail "无法设置 /data 的属主，请检查宿主目录是否可写。"
chmod 0750 /data || fail "无法设置 /data 的权限，请检查宿主目录是否可写。"

secret_path=/data/app-secret
if [ -L "$secret_path" ]; then
  fail "/data/app-secret 不能是符号链接。"
fi
if [ -e "$secret_path" ]; then
  [ -f "$secret_path" ] || fail "/data/app-secret 必须是普通文件。"
  chown "$puid:$pgid" "$secret_path" || fail "无法设置 app-secret 的属主。"
  chmod 0600 "$secret_path" || fail "无法收紧 app-secret 的权限。"
fi

uploads_path=/data/uploads
if [ -L "$uploads_path" ]; then
  fail "/data/uploads 不能是符号链接。"
fi
if [ -e "$uploads_path" ] && [ ! -d "$uploads_path" ]; then
  fail "/data/uploads 必须是目录。"
fi
mkdir -p "$uploads_path" || fail "无法创建附件目录，请检查 /data 的所有权和权限。"

# 只在 uploads 文件系统内修正属主，-P/-xdev 防止跟随链接或进入嵌套挂载。
find -P "$uploads_path" -xdev \( ! -uid "$puid" -o ! -gid "$pgid" \) \
  -exec chown -h "$puid:$pgid" {} + \
  || fail "无法修正附件目录的属主，请检查宿主目录权限。"

exec gosu "$puid:$pgid" "$@"
