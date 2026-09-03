Set-StrictMode -Version Latest

function New-Phase1EForwardedWslEnv {
  # 只向 WSL 转发 Compose 构建与运行必需的环境变量，E2E 登录凭据保留在 Windows Playwright 进程。
  "POSTGRES_PASSWORD:DATA_HOST_DIR:APP_PORT:APP_BASE_URL"
}

function New-Phase1EPlaywrightArguments {
  param(
    [Parameter(Mandatory)] [bool] $AttachmentOnly,
    [Parameter(Mandatory)] [bool] $NotificationOwnershipOnly
  )

  if ($AttachmentOnly -and $NotificationOwnershipOnly) {
    throw "附件专项与通知/所有权专项不能同时运行。"
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
