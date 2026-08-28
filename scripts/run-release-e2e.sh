#!/usr/bin/env bash
set -Eeuo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$repository_root"

export TZ="${TZ:-Asia/Shanghai}"
run_stamp="$(date +%Y%m%d-%H%M%S)"
project_name="huddletab-release-${run_stamp//[^0-9]/}-$PPID"
runtime_parent="${XDG_RUNTIME_DIR:-/tmp}"
data_root="$(mktemp -d -p "$runtime_parent" huddletab-release-e2e.XXXXXX)"
export RELEASE_E2E_ARTIFACTS_DIR="${RELEASE_E2E_ARTIFACTS_DIR:-$repository_root/artifacts/release-e2e/$run_stamp}"
export DATA_HOST_DIR="$data_root"
export APP_PORT="${APP_PORT:-$(shuf -i 20000-49999 -n 1)}"

mkdir -p "$RELEASE_E2E_ARTIFACTS_DIR"
chmod 0777 "$data_root" "$RELEASE_E2E_ARTIFACTS_DIR"

compose=(
  docker compose
  -p "$project_name"
  -f compose.yaml
  -f compose.release-e2e.yaml
)

cleanup() {
  local exit_code=$?
  trap - EXIT
  if ((exit_code != 0)); then
    "${compose[@]}" logs --no-color >"$RELEASE_E2E_ARTIFACTS_DIR/compose.log" 2>&1 || true
    printf '%s\n' "四日发布门禁失败，诊断文件：$RELEASE_E2E_ARTIFACTS_DIR" >&2
  fi
  "${compose[@]}" down --volumes --remove-orphans --rmi local >/dev/null 2>&1 || true

  # 只删除本次 mktemp 创建且名称受控的目录，避免环境变量异常扩大清理范围。
  if [[ -d "$data_root" && "$(basename "$data_root")" == huddletab-release-e2e.* ]]; then
    docker run --rm --entrypoint sh -v "$data_root:/target" postgres:18-alpine \
      -c 'rm -rf /target/* /target/.[!.]* /target/..?*' >/dev/null 2>&1 || true
    rmdir -- "$data_root" 2>/dev/null || true
  fi
  exit "$exit_code"
}
trap cleanup EXIT

printf '%s\n' "正在构建独立生产 App 与 Playwright 镜像……"
"${compose[@]}" build app playwright
printf '%s\n' "正在启动临时生产数据库和应用（TZ=$TZ）……"
"${compose[@]}" up -d --wait --wait-timeout 180 postgres app
printf '%s\n' "正在运行四用户四日账务发布门禁……"
"${compose[@]}" run --rm playwright 2>&1 | tee "$RELEASE_E2E_ARTIFACTS_DIR/run.log"
node scripts/verify-release-e2e-result.mjs "$RELEASE_E2E_ARTIFACTS_DIR/results.json"
printf '%s\n' "四日发布门禁通过，产物目录：$RELEASE_E2E_ARTIFACTS_DIR"
