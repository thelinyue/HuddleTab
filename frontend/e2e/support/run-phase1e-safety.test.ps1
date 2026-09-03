[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Assert-True {
  param([Parameter(Mandatory)] [bool] $Condition, [Parameter(Mandatory)] [string] $Message)
  if (-not $Condition) { throw $Message }
}

$supportPath = Join-Path $PSScriptRoot "phase1e-runner-support.ps1"
if (-not (Test-Path $supportPath)) { throw "runner 安全 helper 尚未实现。" }
. $supportPath

$composeArguments = New-Phase1EComposeArguments -Project "huddletab-phase1e-test" -ComposeFile "/tmp/compose.yaml" -Command "down --remove-orphans"
Assert-True ($composeArguments.Count -eq 3) "Compose WSL 参数数量不正确。"
Assert-True ($composeArguments[2] -eq "docker compose -p 'huddletab-phase1e-test' -f '/tmp/compose.yaml' down --remove-orphans") "Compose 未显式绑定唯一 project。"
$earlyCleanup = Invoke-Phase1EComposeCleanup -ComposeAttempted $false -Cleanup { throw "早期失败后不应执行 Compose cleanup。" }
Assert-True ($null -eq $earlyCleanup) "早期失败仍执行了 Compose cleanup。"
$attemptedCleanup = Invoke-Phase1EComposeCleanup -ComposeAttempted $true -Cleanup { "cleanup-called" }
Assert-True ($attemptedCleanup -eq "cleanup-called") "up 已尝试后没有执行 Compose cleanup。"
$forwarded = New-Phase1EForwardedWslEnv
Assert-True ($forwarded -eq "POSTGRES_PASSWORD:DATA_HOST_DIR:APP_PORT:APP_BASE_URL") "WSLENV 转发集合不符合最小凭据边界。"

$defaultPlaywright = New-Phase1EPlaywrightArguments -AttachmentOnly $false -NotificationOwnershipOnly $false
Assert-True (($defaultPlaywright -join " ") -eq "run test:e2e -- --project=chromium-desktop --project=chromium-mobile --project=webkit-smoke") "默认模式不再是原 Phase 1E 浏览器矩阵。"
$attachmentPlaywright = New-Phase1EPlaywrightArguments -AttachmentOnly $true -NotificationOwnershipOnly $false
Assert-True (($attachmentPlaywright -join " ") -eq "run test:e2e -- attachment.spec.ts --project=chromium-attachment-desktop --project=chromium-attachment-mobile") "AttachmentOnly 没有固定到两个附件项目。"
Assert-True (-not ($attachmentPlaywright -match "--grep|--config|--headed")) "AttachmentOnly 注入了未批准的 Playwright 参数。"
$notificationPlaywright = New-Phase1EPlaywrightArguments -AttachmentOnly $false -NotificationOwnershipOnly $true
Assert-True (($notificationPlaywright -join " ") -eq "run test:e2e -- notification-ownership.spec.ts --project=chromium-notification-desktop --project=chromium-notification-mobile") "NotificationOwnershipOnly 没有固定到两个通知项目。"
Assert-True (-not ($notificationPlaywright -match "--grep|--config|--headed")) "NotificationOwnershipOnly 注入了未批准的 Playwright 参数。"
$exclusiveFailure = try { New-Phase1EPlaywrightArguments -AttachmentOnly $true -NotificationOwnershipOnly $true; $null } catch { $_ }
Assert-True ($null -ne $exclusiveFailure) "两个专项模式同时启用时没有拒绝执行。"

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

Write-Host "runner 安全专项测试通过：显式 project、固定浏览器矩阵、启动门控、凭据边界与双失败诊断均已覆盖。"
