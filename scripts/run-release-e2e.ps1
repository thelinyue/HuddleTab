$ErrorActionPreference = "Stop"

# Windows 入口只负责定位当前仓库；Compose、临时目录和清理均由 WSL 脚本统一处理。
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$wslRepositoryRoot = (& wsl.exe wslpath -a $repositoryRoot).Trim()
if (-not $wslRepositoryRoot) {
  throw "无法将仓库路径转换为 WSL 路径。"
}

& wsl.exe -- bash -lc "cd '$wslRepositoryRoot' && bash ./scripts/run-release-e2e.sh"
exit $LASTEXITCODE
