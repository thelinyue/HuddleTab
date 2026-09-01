#!/bin/sh
set -eu

if ! command -v docker >/dev/null 2>&1; then
  echo "未找到 Docker，无法准备 HuddleTab 数据目录。" >&2
  exit 1
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
compose_file="$repo_dir/compose.yaml"
project_name="huddletab"

if [ "$#" -eq 2 ] && [ "$1" = "--project-name" ]; then
  project_name=$2
  case "$project_name" in
    ''|[-_]*|*[!a-z0-9_-]*)
      echo "Compose project name 必须以小写字母或数字开头，且只能包含小写字母、数字、下划线和连字符。" >&2
      exit 1
      ;;
  esac
elif [ "$#" -ne 0 ]; then
  echo "用法：$0 [--project-name <名称>]；不接受自定义 Compose 文件或其他参数。" >&2
  exit 1
fi

run_compose() {
  docker compose -p "$project_name" -f "$compose_file" "$@"
}

data_host_dir=${DATA_HOST_DIR:-"$repo_dir/data"}
case "$data_host_dir" in
  *,*) echo "DATA_HOST_DIR 不能包含逗号。" >&2; exit 1 ;;
  /*)
    data_root_candidate=$data_host_dir
    relative_data_root=false
    ;;
  *)
    data_root_candidate="$repo_dir/$data_host_dir"
    relative_data_root=true
    ;;
esac

data_root=$(readlink -m -- "$data_root_candidate")
if [ "$relative_data_root" = true ]; then
  case "$data_root" in
    "$repo_dir"/*) ;;
    *) echo "相对 DATA_HOST_DIR 不得越出仓库目录：$data_root" >&2; exit 1 ;;
  esac
fi
case "$data_root" in
  /|/bin|/boot|/dev|/etc|/home|/lib|/lib64|/media|/mnt|/opt|/proc|/root|/run|/sbin|/srv|/sys|/tmp|/usr|/var|"$repo_dir")
    echo "拒绝把根目录、系统级宽泛目录或仓库根目录作为 DATA_HOST_DIR：$data_root" >&2
    exit 1
    ;;
esac
mkdir -p -- "$data_root"
data_root=$(readlink -f -- "$data_root")

app_dir="$data_root/app"
if [ -L "$app_dir" ]; then
  echo "拒绝准备符号链接数据目录：$app_dir" >&2
  exit 1
fi
mkdir -p -- "$app_dir"
resolved_app_dir=$(readlink -f -- "$app_dir")
if [ "$resolved_app_dir" != "$app_dir" ]; then
  echo "数据目录解析结果越出了预期 app 子目录：$resolved_app_dir" >&2
  exit 1
fi

# 固定 Compose 文件并注入已解析的数据根，确保后续 app 服务使用同一个 bind source。
export DATA_HOST_DIR="$data_root"
run_compose config --quiet

# bind mount 会隐藏镜像内 /data 的属主；这里只调整已经校验的挂载点本身，不递归改写已有数据。
docker run --rm --user 0:0 \
  --mount "type=bind,src=$resolved_app_dir,dst=/data" \
  postgres:18-alpine sh -c '
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
