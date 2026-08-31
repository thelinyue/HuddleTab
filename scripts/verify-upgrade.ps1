<#
  生产升级演练：升级前由宿主备份体系保护数据，只运行已提交 Migration，并保留旧镜像 ID。
  会话 Cookie 只传给本地 HTTP 请求，绝不写入 PowerShell 输出或命令历史。
#>
[CmdletBinding()]
param(
  [string]$ComposeFile = "compose.yaml",
  [string]$BaseUrl = $(if ($env:SMOKE_BASE_URL) { $env:SMOKE_BASE_URL } elseif ($env:APP_BASE_URL) { $env:APP_BASE_URL } else { "http://127.0.0.1:5660" })
)

$ErrorActionPreference = "Stop"

function Require-Environment([string]$Name) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "缺少 $Name。升级演练需要具备 System Admin 权限的隔离测试会话。"
  }
  return $value
}

function Invoke-UpgradeStep([string]$Name, [scriptblock]$Action) {
  try { & $Action } catch { throw "[$Name] $($_.Exception.Message)" }
}

try {
  $sessionCookie = Require-Environment "VERIFY_SESSION_COOKIE"
  # 复用本次显式提供的管理员测试会话，避免升级验收使用另一份未声明的凭证。
  $env:SMOKE_SESSION_COOKIE = $sessionCookie
  $env:SMOKE_BASE_URL = $BaseUrl
  $oldImage = (& docker compose -f $ComposeFile images -q app).Trim()
  if ([string]::IsNullOrWhiteSpace($oldImage)) { throw "未找到当前 app 镜像，请先启动 Compose。" }

  Invoke-UpgradeStep "build" {
    & docker compose -f $ComposeFile build app
    if ($LASTEXITCODE -ne 0) { throw "Docker 构建失败，退出码：$LASTEXITCODE。" }
  }
  Invoke-UpgradeStep "start-and-migrate" {
    & docker compose -f $ComposeFile up -d app
    if ($LASTEXITCODE -ne 0) { throw "容器启动或 Migration 失败，退出码：$LASTEXITCODE。" }
  }
  Invoke-UpgradeStep "smoke" {
    & npm run smoke
    if ($LASTEXITCODE -ne 0) { throw "Smoke 失败，退出码：$LASTEXITCODE。" }
  }

  Write-Host "[verify-upgrade] 升级演练通过。旧镜像回退参考：docker compose -f $ComposeFile up -d --no-deps app"
  Write-Host "[verify-upgrade] 保留的旧 app 镜像 ID：$oldImage"
} catch {
  Write-Error "[verify-upgrade] 升级演练失败：$($_.Exception.Message)"
  exit 1
}
