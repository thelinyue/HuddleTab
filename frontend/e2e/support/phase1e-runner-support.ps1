Set-StrictMode -Version Latest

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
