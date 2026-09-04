#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/../../.." && pwd)
prepare_script="$repo_dir/scripts/prepare-data-dir.sh"
temporary_dir=$(mktemp -d /tmp/huddletab-data-permission-XXXXXXXX)
project="huddletab-data-permission-$$"

case "$temporary_dir" in
  /tmp/huddletab-data-permission-*) ;;
  *) echo "拒绝使用未通过前缀校验的测试目录。" >&2; exit 1 ;;
esac

cleanup() {
  if [ -d "$temporary_dir" ]; then
    docker run --rm --user 0:0 \
      --mount "type=bind,src=$temporary_dir,dst=/cleanup" \
      debian:bookworm-slim sh -c 'rm -rf /cleanup/app' >/dev/null
    rmdir "$temporary_dir"
  fi
}
trap cleanup EXIT INT TERM

mkdir "$temporary_dir/app"
docker run --rm --user 0:0 \
  --mount "type=bind,src=$temporary_dir/app,dst=/data" \
  debian:bookworm-slim sh -c 'chown 0:0 /data && chmod 0755 /data'

before=$(stat -c '%u:%g:%a' "$temporary_dir/app")
if [ "$before" != "0:0:755" ]; then
  echo "未准备目录状态不符合预期：$before" >&2
  exit 1
fi
if docker run --rm --user 10001:10001 \
  --mount "type=bind,src=$temporary_dir/app,dst=/data" \
  debian:bookworm-slim sh -c 'touch /data/unprepared' >/dev/null 2>&1; then
  echo "UID 10001 不应写入 root:root 0755 目录。" >&2
  exit 1
fi

export DATA_HOST_DIR="$temporary_dir"
"$prepare_script" --project-name "$project"

after=$(stat -c '%u:%g:%a' "$temporary_dir/app")
if [ "$after" != "10001:10001:750" ]; then
  echo "准备后目录状态不安全：$after" >&2
  exit 1
fi
docker run --rm --user 10001:10001 \
  --mount "type=bind,src=$temporary_dir/app,dst=/data" \
  debian:bookworm-slim sh -c 'touch /data/prepared'

echo "数据目录权限测试通过：准备前 UID 10001 不可写，准备后属主为 10001:10001、权限为 0750 且可写。"
