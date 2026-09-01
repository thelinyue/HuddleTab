[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Assert-True {
  param([Parameter(Mandatory)] [bool] $Condition, [Parameter(Mandatory)] [string] $Message)
  if (-not $Condition) { throw $Message }
}

$supportPath = Join-Path $PSScriptRoot "phase1e-runner-support.ps1"
$runnerPath = Join-Path (Split-Path -Parent $PSScriptRoot) "run-phase1e.ps1"
if (-not (Test-Path $supportPath)) { throw "runner 安全 helper 尚未实现。" }
. $supportPath

$composeArguments = New-Phase1EComposeArguments -Project "huddletab-phase1e-test" -ComposeFile "/tmp/compose.yaml" -Command "down --remove-orphans"
Assert-True ($composeArguments.Count -eq 3) "Compose WSL 参数数量不正确。"
Assert-True ($composeArguments[2] -eq "docker compose -p 'huddletab-phase1e-test' -f '/tmp/compose.yaml' down --remove-orphans") "Compose 未显式绑定唯一 project。"
$earlyCleanup = Invoke-Phase1EComposeCleanup -ComposeAttempted $false -Cleanup { throw "早期失败后不应执行 Compose cleanup。" }
Assert-True ($null -eq $earlyCleanup) "早期失败仍执行了 Compose cleanup。"
$attemptedCleanup = Invoke-Phase1EComposeCleanup -ComposeAttempted $true -Cleanup { "cleanup-called" }
Assert-True ($attemptedCleanup -eq "cleanup-called") "up 已尝试后没有执行 Compose cleanup。"

$primary = [System.Management.Automation.ErrorRecord]::new(
  [System.InvalidOperationException]::new("主流程失败标记"),
  "Phase1EPrimary",
  [System.Management.Automation.ErrorCategory]::OperationStopped,
  $null
)
$cleanup = [System.Management.Automation.ErrorRecord]::new(
  [System.IO.IOException]::new("清理失败标记"),
  "Phase1ECleanup",
  [System.Management.Automation.ErrorCategory]::WriteError,
  $null
)
$combined = try { Complete-Phase1EFailure -PrimaryFailure $primary -CleanupFailure $cleanup; $null } catch { $_ }
Assert-True ($null -ne $combined) "主失败和清理失败同时存在时没有抛出诊断。"
Assert-True ($combined.Exception.Message.StartsWith("主流程失败标记")) "组合诊断没有以主失败为首。"
Assert-True ($combined.Exception.Message.Contains("清理失败标记")) "组合诊断没有附带清理失败。"

$source = Get-Content -Raw $runnerPath
Assert-True ($source -match '\$composeAttempted\s*=\s*\$true\s*\r?\n\s*Invoke-Compose\s+"up -d --build --wait"') "runner 没有在 up 前记录 composeAttempted。"
Assert-True ($source -match 'Invoke-Phase1EComposeCleanup -ComposeAttempted \$composeAttempted') "runner 没有使用已验证的 composeAttempted 门控。"
Assert-True ($source -notmatch '\$forwarded\s*=\s*"[^"]*HUDDLETAB_E2E_(USERNAME|PASSWORD)') "E2E 登录凭据仍被加入 WSLENV。"

Write-Host "runner 安全专项测试通过：显式 project、启动门控、凭据边界与双失败诊断均已覆盖。"
