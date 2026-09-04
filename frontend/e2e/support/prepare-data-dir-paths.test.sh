#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/../../.." && pwd)
prepare_script="$repo_dir/scripts/prepare-data-dir.sh"
temporary_dir=$(mktemp -d /tmp/huddletab-prepare-paths-XXXXXXXX)
fake_bin="$temporary_dir/bin"

case "$temporary_dir" in
  /tmp/huddletab-prepare-paths-*) ;;
  *) echo "拒绝使用未通过前缀校验的测试目录。" >&2; exit 1 ;;
esac

cleanup() {
  rm -rf -- "$temporary_dir"
}
trap cleanup EXIT INT TERM

mkdir -p "$fake_bin" "$temporary_dir/symlink-data" "$temporary_dir/escape-target"
cat >"$fake_bin/docker" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod +x "$fake_bin/docker"
ln -s "$temporary_dir/escape-target" "$temporary_dir/symlink-data/app"

if PATH="$fake_bin:$PATH" DATA_HOST_DIR="$temporary_dir/symlink-data" \
  "$prepare_script" --project-name huddletab-path-test >/dev/null 2>&1; then
  echo "数据目录脚本不应接受越出数据根目录的 app 符号链接。" >&2
  exit 1
fi

if [ "$(stat -c '%u:%g:%a' "$temporary_dir/escape-target")" != "$(id -u):$(id -g):755" ]; then
  echo "拒绝符号链接前修改了逃逸目标。" >&2
  exit 1
fi

if PATH="$fake_bin:$PATH" DATA_HOST_DIR=/ \
  "$prepare_script" --project-name huddletab-path-test >/dev/null 2>&1; then
  echo "数据目录脚本不应接受根目录作为 DATA_HOST_DIR。" >&2
  exit 1
fi

mkdir -p "$temporary_dir/copied-repo/scripts"
cp "$prepare_script" "$temporary_dir/copied-repo/scripts/prepare-data-dir.sh"
if PATH="$fake_bin:$PATH" DATA_HOST_DIR=.. \
  "$temporary_dir/copied-repo/scripts/prepare-data-dir.sh" --project-name huddletab-path-test >/dev/null 2>&1; then
  echo "相对 DATA_HOST_DIR 不应越出仓库目录。" >&2
  exit 1
fi
if [ -e "$temporary_dir/app" ]; then
  echo "拒绝越界相对路径前已经创建了仓库外目录。" >&2
  exit 1
fi

echo "数据目录路径测试通过：根目录、越界相对路径与 app 符号链接均在容器操作前被拒绝。"
