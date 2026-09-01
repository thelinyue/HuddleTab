#!/bin/sh
set -eu

if ! command -v docker >/dev/null 2>&1; then
  echo "未找到 Docker，无法准备 HuddleTab 数据目录。" >&2
  exit 1
fi

# bind mount 会隐藏镜像内 /data 的属主；这里只调整挂载点本身，不递归改写已有数据。
docker compose "$@" run --rm --no-deps --user 0:0 --entrypoint sh app -c '
  set -eu
  chown 10001:10001 /data
  chmod 0750 /data
  owner=$(stat -c "%u:%g" /data)
  mode=$(stat -c "%a" /data)
  if [ "$owner" != "10001:10001" ] || [ "$mode" != "750" ]; then
    echo "数据目录准备失败：预期属主 10001:10001、权限 0750，实际为 $owner、$mode。" >&2
    exit 1
  fi
'

echo "数据目录已准备：运行容器 UID 10001 可写，目录权限为 0750。"
