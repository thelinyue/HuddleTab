$ErrorActionPreference = "Stop"

# Windows 入口只负责定位当前仓库；Compose、临时目录和清理均由 WSL 脚本统一处理。
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

& wsl.exe --cd $repositoryRoot -- bash ./scripts/run-release-e2e.sh
exit $LASTEXITCODE
