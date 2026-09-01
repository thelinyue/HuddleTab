#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/../../.." && pwd)
compose_file="$script_dir/data-directory-permissions.compose.yaml"
prepare_script="$repo_dir/scripts/prepare-data-dir.sh"
temporary_dir=$(mktemp -d /tmp/huddletab-prepare-arguments-XXXXXXXX)
project="huddletab-prepare-arguments-$$"

case "$temporary_dir" in
  /tmp/huddletab-prepare-arguments-*) ;;
  *) echo "拒绝使用未通过前缀校验的测试目录。" >&2; exit 1 ;;
esac

cleanup() {
  docker compose -p "$project" -f "$compose_file" down --remove-orphans >/dev/null 2>&1 || true
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

if HUDDLETAB_PERMISSION_TEST_DIR="$temporary_dir" \
  "$prepare_script" -p "$project" -f "$compose_file" >/dev/null 2>&1; then
  echo "数据目录脚本不应接受自定义 Compose 参数。" >&2
  exit 1
fi

actual=$(stat -c '%u:%g:%a' "$temporary_dir/app")
if [ "$actual" != "0:0:755" ]; then
  echo "拒绝非法参数前已经修改了目标目录：$actual" >&2
  exit 1
fi

echo "数据目录参数测试通过：自定义 Compose 参数在任何 root 修改前被拒绝。"
