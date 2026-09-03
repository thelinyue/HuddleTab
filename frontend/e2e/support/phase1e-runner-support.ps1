Set-StrictMode -Version Latest

function New-Phase1EForwardedWslEnv {
  # 只向 WSL 转发 Compose 构建与运行必需的环境变量，E2E 登录凭据保留在 Windows Playwright 进程。
  "POSTGRES_PASSWORD:DATA_HOST_DIR:APP_PORT:APP_BASE_URL:APP_VERSION:TRUST_PROXY"
}

function New-Phase1EPlaywrightArguments {
  param(
    [Parameter(Mandatory)] [bool] $AttachmentOnly,
    [Parameter(Mandatory)] [bool] $NotificationOwnershipOnly,
    [bool] $Phase2Only = $false,
    [bool] $IPhoneSimulationOnly = $false,
    [bool] $Task29Only = $false,
    [bool] $Task30Only = $false,
    [bool] $Task31Only = $false,
    [bool] $ReleaseVerification = $false
  )

  if (@($AttachmentOnly, $NotificationOwnershipOnly, $Phase2Only, $IPhoneSimulationOnly, $Task29Only, $Task30Only, $Task31Only, $ReleaseVerification).Where({ $_ }).Count -gt 1) {
    throw "附件、通知/所有权、Phase 2、iPhone 模拟、Task 29、Task 30、Task 31 与最终 Release Verification 模式不能同时运行。"
  }

  if ($AttachmentOnly) {
    return @(
      "run",
      "test:e2e",
      "--",
      "attachment.spec.ts",
      "--project=chromium-attachment-desktop",
      "--project=chromium-attachment-mobile"
    )
  }
  if ($NotificationOwnershipOnly) {
    return @(
      "run",
      "test:e2e",
      "--",
      "notification-ownership.spec.ts",
      "--project=chromium-notification-desktop",
      "--project=chromium-notification-mobile"
    )
  }
  if ($Phase2Only) {
    return @(
      "run",
      "test:e2e",
      "--",
      "--project=chromium-phase2-desktop",
      "--project=chromium-phase2-mobile",
      "--project=chromium-attachment-desktop",
      "--project=chromium-attachment-mobile",
      "--project=chromium-notification-desktop",
      "--project=chromium-notification-mobile",
      "--project=webkit-smoke"
    )
  }
  if ($IPhoneSimulationOnly) {
    return @(
      "run",
      "test:e2e",
      "--",
      "--project=chromium-phase2-mobile",
      "--project=chromium-attachment-mobile",
      "--project=webkit-iphone-ui"
    )
  }
  if ($Task29Only) {
    return @(
      "run",
      "test:e2e",
      "--",
      "task29.spec.ts",
      "--project=chromium-task29-desktop",
      "--project=chromium-task29-mobile"
    )
  }
  if ($Task30Only) {
    return @(
      "run",
      "test:e2e",
      "--",
      "task30.spec.ts",
      "--project=chromium-task30-desktop",
      "--project=chromium-task30-mobile"
    )
  }
  if ($Task31Only) {
    return @(
      "run",
      "test:e2e",
      "--",
      "task31.spec.ts",
      "--project=chromium-task31-desktop",
      "--project=chromium-task31-mobile"
    )
  }
  if ($ReleaseVerification) {
    return @(
      "run",
      "test:e2e",
      "--",
      "--project=chromium-desktop",
      "--project=chromium-mobile",
      "--project=chromium-phase2-desktop",
      "--project=chromium-phase2-mobile",
      "--project=chromium-attachment-desktop",
      "--project=chromium-attachment-mobile",
      "--project=chromium-notification-desktop",
      "--project=chromium-notification-mobile",
      "--project=chromium-task29-desktop",
      "--project=chromium-task29-mobile",
      "--project=chromium-task30-desktop",
      "--project=chromium-task30-mobile",
      "--project=chromium-task31-desktop",
      "--project=chromium-task31-mobile",
      "--project=webkit-iphone-ui",
      "--project=webkit-smoke"
    )
  }
  @(
    "run",
    "test:e2e",
    "--",
    "--project=chromium-desktop",
    "--project=chromium-mobile",
    "--project=webkit-smoke"
  )
}

function New-Phase1EComposeArguments {
  param(
    [Parameter(Mandatory)] [string] $Project,
    [Parameter(Mandatory)] [string] $ComposeFile,
    [Parameter(Mandatory)] [string] $Command
  )

  @("sh", "-lc", "docker compose -p '$Project' -f '$ComposeFile' $Command")
}

function Invoke-Phase1EComposeCleanup {
  param(
    [Parameter(Mandatory)] [bool] $ComposeAttempted,
    [Parameter(Mandatory)] [scriptblock] $Cleanup
  )

  # up 尚未尝试时不执行任何 Compose 命令，早期初始化失败不会触及默认或现有项目。
  if ($ComposeAttempted) { & $Cleanup }
}

function Complete-Phase1EFailure {
  param(
    [AllowNull()] [System.Management.Automation.ErrorRecord] $PrimaryFailure,
    [AllowNull()] [System.Management.Automation.ErrorRecord] $CleanupFailure
  )

  if ($PrimaryFailure) {
    if ($CleanupFailure) {
      # 主流程错误保留在诊断首位，清理错误作为附加上下文，避免 finally 覆盖真正根因。
      $message = "$($PrimaryFailure.Exception.Message)`n同时发生清理失败：$($CleanupFailure.Exception.Message)"
      $combined = [System.Exception]::new($message, $PrimaryFailure.Exception)
      $combined.Data["Phase1ECleanupFailure"] = $CleanupFailure.Exception.ToString()
      throw $combined
    }
    throw $PrimaryFailure
  }
  if ($CleanupFailure) { throw $CleanupFailure }
}
