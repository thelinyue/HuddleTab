#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/../../.." && pwd)
temporary_dir=$(mktemp -d /tmp/huddletab-data-permission-XXXXXXXX)
test_image=${HUDDLETAB_TEST_IMAGE:-huddletab-permission-test-$$}
owns_image=false

case "$temporary_dir" in
  /tmp/huddletab-data-permission-*) ;;
  *) echo "拒绝使用未通过前缀校验的测试目录。" >&2; exit 1 ;;
esac

cleanup() {
  if [ -d "$temporary_dir" ]; then
    docker run --rm --user 0:0 \
      --mount "type=bind,src=$temporary_dir,dst=/cleanup" \
      debian:bookworm-slim sh -c 'rm -rf /cleanup/app /cleanup/symlink-target /cleanup/symlink-data /cleanup/symlink-secret-data /cleanup/symlink-secret-target /cleanup/symlink-output /cleanup/symlink-secret-output' >/dev/null 2>&1 || true
    rmdir "$temporary_dir" 2>/dev/null || true
  fi
  if [ "$owns_image" = true ]; then
    docker image rm "$test_image" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

if [ -z "${HUDDLETAB_TEST_IMAGE:-}" ]; then
  owns_image=true
  docker build --tag "$test_image" --build-arg APP_VERSION=0.0.5 "$repo_dir"
fi

assert_stat() {
  format=$1
  relative_path=$2
  expected=$3
  actual=$(docker run --rm --user 0:0 \
    --mount "type=bind,src=$temporary_dir,dst=/inspect,readonly" \
    debian:bookworm-slim stat -c "$format" "/inspect/$relative_path")
  if [ "$actual" != "$expected" ]; then
    echo "权限状态不符合预期：$relative_path 应为 $expected，实际为 $actual。" >&2
    exit 1
  fi
}

mkdir "$temporary_dir/app"
docker run --rm --user 0:0 \
  --mount "type=bind,src=$temporary_dir/app,dst=/data" \
  debian:bookworm-slim sh -c '
  set -eu
  mkdir -p /data/uploads/old
  printf old-secret >/data/app-secret
  printf old-attachment >/data/uploads/old/photo.webp
  printf untouched >/data/host-owned-file
  chown 10001:10001 /data/app-secret /data/uploads /data/uploads/old /data/uploads/old/photo.webp
  chmod 0644 /data/app-secret
  chown 10002:10003 /data/host-owned-file
  chmod 0600 /data/host-owned-file
  chown 0:0 /data
  chmod 0755 /data
'

if ! docker run --rm \
  --env PUID=10001 --env PGID=10001 \
  --mount "type=bind,src=$temporary_dir/app,dst=/data" \
  "$test_image" sh -c '
  test "$(id -u)" = 10001
  test "$(id -g)" = 10001
  test "$(id -G)" = 10001
  grep -q "^CapEff:[[:space:]]*0000000000000000$" /proc/self/status
  test -w /data
  touch /data/default-file
'; then
  echo "默认 PUID/PGID 无法以非 root 身份运行。" >&2
  exit 1
fi

assert_stat '%u:%g:%a' app '10001:10001:750'

custom_output=$(docker run --rm \
  --env PUID=12345 --env PGID=12346 \
  --mount "type=bind,src=$temporary_dir/app,dst=/data" \
  "$test_image" sh -c '
  test "$(id -u)" = 12345
  test "$(id -g)" = 12346
  test "$(id -G)" = 12346
  grep -q "^CapEff:[[:space:]]*0000000000000000$" /proc/self/status
  printf custom-attachment >/data/uploads/custom.webp
  printf ready
')
if [ "$custom_output" != "ready" ]; then
  echo "自定义 PUID/PGID 运行结果异常：$custom_output" >&2
  exit 1
fi

assert_stat '%u:%g:%a' app '12345:12346:750'
assert_stat '%u:%g:%a' app/app-secret '12345:12346:600'
assert_stat '%u:%g' app/uploads/old/photo.webp '12345:12346'
assert_stat '%u:%g' app/uploads/custom.webp '12345:12346'
assert_stat '%u:%g:%a' app/host-owned-file '10002:10003:600'

mkdir -p "$temporary_dir/symlink-data" "$temporary_dir/symlink-target"
docker run --rm --user 0:0 \
  --mount "type=bind,src=$temporary_dir,dst=/setup" \
  debian:bookworm-slim chown 10002:10003 /setup/symlink-target
ln -s "$temporary_dir/symlink-target" "$temporary_dir/symlink-data/uploads"
symlink_output="$temporary_dir/symlink-output"
if docker run --rm \
  --env PUID=12345 --env PGID=12346 \
  --mount "type=bind,src=$temporary_dir/symlink-data,dst=/data" \
  "$test_image" true >"$symlink_output" 2>&1; then
  echo "符号链接附件目录不应被入口接受。" >&2
  exit 1
fi
if [ "$(stat -c '%u:%g' "$temporary_dir/symlink-target")" != "10002:10003" ]; then
  echo "拒绝符号链接前修改了逃逸目标。" >&2
  exit 1
fi

mkdir -p "$temporary_dir/symlink-secret-data"
docker run --rm --user 0:0 \
  --mount "type=bind,src=$temporary_dir,dst=/setup" \
  debian:bookworm-slim sh -c 'printf outside-secret >/setup/symlink-secret-target && chown 10002:10003 /setup/symlink-secret-target'
ln -s "$temporary_dir/symlink-secret-target" "$temporary_dir/symlink-secret-data/app-secret"
secret_symlink_output="$temporary_dir/symlink-secret-output"
if docker run --rm \
  --env PUID=12345 --env PGID=12346 \
  --mount "type=bind,src=$temporary_dir/symlink-secret-data,dst=/data" \
  "$test_image" true >"$secret_symlink_output" 2>&1; then
  echo "符号链接 app-secret 不应被入口接受。" >&2
  exit 1
fi
if [ "$(stat -c '%u:%g' "$temporary_dir/symlink-secret-target")" != "10002:10003" ]; then
  echo "拒绝 app-secret 符号链接前修改了逃逸目标。" >&2
  exit 1
fi

invalid_output=$(docker run --rm \
  --env PUID=0 --env PGID=10001 \
  --mount "type=bind,src=$temporary_dir/app,dst=/data" \
  "$test_image" true 2>&1 || true)
case "$invalid_output" in
  *"PUID 不能为 0"*) ;;
  *) echo "非法 PUID 未输出明确中文错误：$invalid_output" >&2; exit 1 ;;
esac

invalid_range_output=$(docker run --rm \
  --env PUID=10001 --env PGID=2147483648 \
  --mount "type=bind,src=$temporary_dir/app,dst=/data" \
  "$test_image" true 2>&1 || true)
case "$invalid_range_output" in
  *"PGID 必须是 1 到 2147483647 之间的十进制 UID/GID"*) ;;
  *) echo "超范围 PGID 未输出明确中文错误：$invalid_range_output" >&2; exit 1 ;;
esac

explicit_user_output=$(docker run --rm --user 10001:10001 \
  --mount "type=bind,src=$temporary_dir/app,dst=/data" \
  "$test_image" true 2>&1 || true)
case "$explicit_user_output" in
  *"入口需要 root 初始化宿主挂载目录权限"*) ;;
  *) echo "显式 user 覆盖未在入口阶段明确失败：$explicit_user_output" >&2; exit 1 ;;
esac

echo "数据目录权限测试通过：默认与自定义 PUID/PGID 均以无 capabilities 的非 root 身份运行，旧附件可迁移，未知文件和符号链接目标不被改写。"
