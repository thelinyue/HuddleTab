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
Assert-True ($forwarded -eq "POSTGRES_PASSWORD:DATA_HOST_DIR:APP_PORT:APP_BASE_URL:APP_VERSION") "WSLENV 转发集合不符合最小构建配置边界。"

$defaultPlaywright = New-Phase1EPlaywrightArguments -AttachmentOnly $false -NotificationOwnershipOnly $false
Assert-True (($defaultPlaywright -join " ") -eq "run test:e2e -- --project=chromium-desktop --project=chromium-mobile --project=webkit-smoke") "默认模式不再是原 Phase 1E 浏览器矩阵。"
$attachmentPlaywright = New-Phase1EPlaywrightArguments -AttachmentOnly $true -NotificationOwnershipOnly $false
Assert-True (($attachmentPlaywright -join " ") -eq "run test:e2e -- attachment.spec.ts --project=chromium-attachment-desktop --project=chromium-attachment-mobile") "AttachmentOnly 没有固定到两个附件项目。"
Assert-True (-not ($attachmentPlaywright -match "--grep|--config|--headed")) "AttachmentOnly 注入了未批准的 Playwright 参数。"
$notificationPlaywright = New-Phase1EPlaywrightArguments -AttachmentOnly $false -NotificationOwnershipOnly $true
Assert-True (($notificationPlaywright -join " ") -eq "run test:e2e -- notification-ownership.spec.ts --project=chromium-notification-desktop --project=chromium-notification-mobile") "NotificationOwnershipOnly 没有固定到两个通知项目。"
Assert-True (-not ($notificationPlaywright -match "--grep|--config|--headed")) "NotificationOwnershipOnly 注入了未批准的 Playwright 参数。"
$phase2Playwright = New-Phase1EPlaywrightArguments -AttachmentOnly $false -NotificationOwnershipOnly $false -Phase2Only $true
Assert-True (($phase2Playwright -join " ") -eq "run test:e2e -- --project=chromium-phase2-desktop --project=chromium-phase2-mobile --project=chromium-attachment-desktop --project=chromium-attachment-mobile --project=chromium-notification-desktop --project=chromium-notification-mobile --project=webkit-smoke") "Phase2Only 没有固定到 Phase 2、附件、通知/所有权和 WebKit smoke 项目。"
Assert-True (-not ($phase2Playwright -match "--grep|--config|--headed")) "Phase2Only 注入了未批准的 Playwright 参数。"
$task29Playwright = New-Phase1EPlaywrightArguments -AttachmentOnly $false -NotificationOwnershipOnly $false -Task29Only $true
Assert-True (($task29Playwright -join " ") -eq "run test:e2e -- task29.spec.ts --project=chromium-task29-desktop --project=chromium-task29-mobile") "Task29Only 没有固定到管理员 Desktop/Mobile 项目。"
Assert-True (-not ($task29Playwright -match "--grep|--config|--headed")) "Task29Only 注入了未批准的 Playwright 参数。"
$task30Playwright = New-Phase1EPlaywrightArguments -AttachmentOnly $false -NotificationOwnershipOnly $false -Task30Only $true
Assert-True (($task30Playwright -join " ") -eq "run test:e2e -- task30.spec.ts --project=chromium-task30-desktop --project=chromium-task30-mobile") "Task30Only 没有固定到摘要/CSV Desktop/Mobile 项目。"
Assert-True (-not ($task30Playwright -match "--grep|--config|--headed")) "Task30Only 注入了未批准的 Playwright 参数。"
$task31Playwright = New-Phase1EPlaywrightArguments -AttachmentOnly $false -NotificationOwnershipOnly $false -Task31Only $true
Assert-True (($task31Playwright -join " ") -eq "run test:e2e -- task31.spec.ts --project=chromium-task31-desktop --project=chromium-task31-mobile") "Task31Only 没有固定到系统信息 Desktop/Mobile 项目。"
Assert-True (-not ($task31Playwright -match "--grep|--config|--headed")) "Task31Only 注入了未批准的 Playwright 参数。"
$releasePlaywright = New-Phase1EPlaywrightArguments -AttachmentOnly $false -NotificationOwnershipOnly $false -ReleaseVerification $true
Assert-True (($releasePlaywright -join " ") -eq "run test:e2e -- --project=chromium-desktop --project=chromium-mobile --project=chromium-phase2-desktop --project=chromium-phase2-mobile --project=chromium-attachment-desktop --project=chromium-attachment-mobile --project=chromium-notification-desktop --project=chromium-notification-mobile --project=chromium-task29-desktop --project=chromium-task29-mobile --project=chromium-task30-desktop --project=chromium-task30-mobile --project=chromium-task31-desktop --project=chromium-task31-mobile --project=webkit-smoke") "ReleaseVerification 没有固定到完整浏览器矩阵。"
Assert-True (-not ($releasePlaywright -match "--grep|--config|--headed")) "ReleaseVerification 注入了未批准的 Playwright 参数。"
$exclusiveFailure = try { New-Phase1EPlaywrightArguments -AttachmentOnly $true -NotificationOwnershipOnly $true; $null } catch { $_ }
Assert-True ($null -ne $exclusiveFailure) "两个专项模式同时启用时没有拒绝执行。"
$phase2ExclusiveFailure = try { New-Phase1EPlaywrightArguments -AttachmentOnly $false -NotificationOwnershipOnly $false -Phase2Only $true -ErrorAction Stop; New-Phase1EPlaywrightArguments -AttachmentOnly $true -NotificationOwnershipOnly $false -Phase2Only $true; $null } catch { $_ }
Assert-True ($null -ne $phase2ExclusiveFailure) "Phase2Only 与专项模式同时启用时没有拒绝执行。"
$task29ExclusiveFailure = try { New-Phase1EPlaywrightArguments -AttachmentOnly $false -NotificationOwnershipOnly $false -Phase2Only $false -Task29Only $true; New-Phase1EPlaywrightArguments -AttachmentOnly $false -NotificationOwnershipOnly $false -Phase2Only $true -Task29Only $true; $null } catch { $_ }
Assert-True ($null -ne $task29ExclusiveFailure) "Task29Only 与其他专项模式同时启用时没有拒绝执行。"
$task30ExclusiveFailure = try { New-Phase1EPlaywrightArguments -AttachmentOnly $false -NotificationOwnershipOnly $false -Task30Only $true; New-Phase1EPlaywrightArguments -AttachmentOnly $false -NotificationOwnershipOnly $false -Task29Only $true -Task30Only $true; $null } catch { $_ }
Assert-True ($null -ne $task30ExclusiveFailure) "Task30Only 与其他专项模式同时启用时没有拒绝执行。"
$task31ExclusiveFailure = try { New-Phase1EPlaywrightArguments -AttachmentOnly $false -NotificationOwnershipOnly $false -Task31Only $true; New-Phase1EPlaywrightArguments -AttachmentOnly $false -NotificationOwnershipOnly $false -Task30Only $true -Task31Only $true; $null } catch { $_ }
Assert-True ($null -ne $task31ExclusiveFailure) "Task31Only 与其他专项模式同时启用时没有拒绝执行。"
$releaseExclusiveFailure = try { New-Phase1EPlaywrightArguments -AttachmentOnly $false -NotificationOwnershipOnly $false -ReleaseVerification $true; New-Phase1EPlaywrightArguments -AttachmentOnly $false -NotificationOwnershipOnly $false -Task31Only $true -ReleaseVerification $true; $null } catch { $_ }
Assert-True ($null -ne $releaseExclusiveFailure) "ReleaseVerification 与其他专项模式同时启用时没有拒绝执行。"

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
