[CmdletBinding()]
param(
  [switch] $AttachmentOnly,
  [switch] $NotificationOwnershipOnly,
  [switch] $Phase2Only,
  [switch] $Task29Only,
  [switch] $Task30Only,
  [switch] $Task31Only,
  [switch] $ReleaseVerification
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$frontendDir = Split-Path -Parent $PSScriptRoot
$repoDir = Split-Path -Parent $frontendDir
$artifactDir = Join-Path $frontendDir "artifacts"
. (Join-Path $PSScriptRoot "support/phase1e-runner-support.ps1")
$composeProject = "huddletab-phase1e-$([Guid]::NewGuid().ToString('N').Substring(0, 10))"
$temporaryData = $null
$composeAttempted = $false
$primaryFailure = $null
$script:composeFileWsl = $null
$originalWslEnv = $env:WSLENV
$originalAppVersion = $env:APP_VERSION
$originalPostgresDb = $env:POSTGRES_DB
$sensitiveNames = @(
  "HUDDLETAB_E2E_USERNAME",
  "HUDDLETAB_E2E_PASSWORD",
  "POSTGRES_PASSWORD"
)

if (@($AttachmentOnly, $NotificationOwnershipOnly, $Phase2Only, $Task29Only, $Task30Only, $Task31Only, $ReleaseVerification).Where({ $_ }).Count -gt 1) {
  throw "附件、通知/所有权、Phase 2、Task 29、Task 30、Task 31 与最终 Release Verification 模式不能同时运行。"
}

function Invoke-Wsl {
  param(
    [Parameter(Mandatory)] [string[]] $ArgumentList,
    [string] $InputText,
    [switch] $AllowFailure,
    [switch] $Quiet
  )

  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = "wsl.exe"
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.RedirectStandardInput = $true
  foreach ($argument in $ArgumentList) { [void] $startInfo.ArgumentList.Add($argument) }

  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  [void] $process.Start()
  if ($PSBoundParameters.ContainsKey("InputText")) {
    $process.StandardInput.Write($InputText)
  }
  $process.StandardInput.Close()
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $process.WaitForExit()
  $stdout = $stdoutTask.GetAwaiter().GetResult()
  $stderr = $stderrTask.GetAwaiter().GetResult()
  $combined = "$stdout$stderr".TrimEnd()
  if (-not $Quiet -and $combined) { Write-Host $combined }
  if (-not $AllowFailure -and $process.ExitCode -ne 0) {
    throw "WSL 命令失败（退出码 $($process.ExitCode)）。"
  }
  [PSCustomObject]@{ ExitCode = $process.ExitCode; Output = $combined }
}

function Invoke-Compose {
  param(
    [Parameter(Mandatory)] [string] $Command,
    [string] $InputText,
    [switch] $AllowFailure,
    [switch] $Quiet
  )
  $arguments = New-Phase1EComposeArguments -Project $composeProject -ComposeFile $script:composeFileWsl -Command $Command
  $invoke = @{ ArgumentList = $arguments; AllowFailure = $AllowFailure; Quiet = $Quiet }
  if ($PSBoundParameters.ContainsKey("InputText")) { $invoke.InputText = $InputText }
  Invoke-Wsl @invoke
}

function Get-AvailablePort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $listener.Start()
  try { return ([System.Net.IPEndPoint] $listener.LocalEndpoint).Port }
  finally { $listener.Stop() }
}

function ConvertTo-WslPath {
  param([Parameter(Mandatory)] [string] $WindowsPath)
  $fullPath = [System.IO.Path]::GetFullPath($WindowsPath)
  if ($fullPath -notmatch '^([A-Za-z]):\\(.*)$') {
    throw "Phase 1E 入口只接受带盘符的 Windows 仓库路径。"
  }
  $drive = $Matches[1].ToLowerInvariant()
  $tail = $Matches[2].Replace('\', '/')
  "/mnt/$drive/$tail"
}

function Wait-Health {
  param([Parameter(Mandatory)] [string] $BaseUrl)
  for ($attempt = 1; $attempt -le 60; $attempt++) {
    try {
      $response = Invoke-WebRequest -Uri "$BaseUrl/api/health" -TimeoutSec 2 -UseBasicParsing
      if ($response.StatusCode -eq 200) { return }
    } catch {
      if ($attempt -eq 60) { throw "HuddleTab health 在等待期内未就绪。" }
      Start-Sleep -Seconds 2
    }
  }
}

function Assert-TemporaryPath {
  param([Parameter(Mandatory)] [string] $Path)
  if ($Path -notmatch '^/tmp/huddletab-phase1e-[A-Za-z0-9._-]+$') {
    throw "拒绝清理未通过前缀校验的 WSL 路径。"
  }
}

try {
  Write-Host "[1/10] 准备前端依赖与 Playwright 浏览器"
  Push-Location $frontendDir
  try {
    npm ci
    if ($LASTEXITCODE -ne 0) { throw "前端依赖安装失败。" }
    npx playwright install chromium webkit
    if ($LASTEXITCODE -ne 0) { throw "Playwright 浏览器安装失败。" }
  } finally {
    Pop-Location
  }

  New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null
  $script:composeFileWsl = ConvertTo-WslPath (Join-Path $repoDir "compose.yaml")
  $temporaryData = (Invoke-Wsl -ArgumentList @("mktemp", "-d", "/tmp/huddletab-phase1e-XXXXXXXX") -Quiet).Output.Trim()
  $temporaryData = (Invoke-Wsl -ArgumentList @("readlink", "-f", "--", $temporaryData) -Quiet).Output.Trim()
  Assert-TemporaryPath $temporaryData
  # 先模拟新宿主创建的普通目录；app 挂载点随后必须通过正式准备流程收紧，而不是依赖 0777。
  Invoke-Wsl -ArgumentList @("install", "-d", "-m", "0755", "--", "$temporaryData/app", "$temporaryData/postgres") -Quiet | Out-Null

  $appPort = Get-AvailablePort
  $baseUrl = "http://127.0.0.1:$appPort"
  $env:HUDDLETAB_E2E_USERNAME = "phase1e$([Guid]::NewGuid().ToString('N').Substring(0, 12))"
  $env:HUDDLETAB_E2E_PASSWORD = "$([Guid]::NewGuid().ToString('N'))Aa1!"
  $env:POSTGRES_PASSWORD = "$([Guid]::NewGuid().ToString('N'))Pg1!"
  $env:DATA_HOST_DIR = $temporaryData
  $env:APP_PORT = [string] $appPort
  $env:APP_BASE_URL = $baseUrl
  $env:APP_VERSION = if ($ReleaseVerification) { "0.0.3" } else { "dev" }
  # Release Verification 的父进程会暂时使用另一个 PostgreSQL 测试库；E2E Compose 必须固定自己的库名。
  $env:POSTGRES_DB = "huddletab"
  $env:HUDDLETAB_E2E_BASE_URL = $baseUrl
  $env:HUDDLETAB_E2E_ATTACHMENT_MODE = if ($AttachmentOnly) { "true" } else { "false" }
  $env:HUDDLETAB_E2E_TASK29_MODE = if ($Task29Only) { "true" } else { "false" }
  $env:HUDDLETAB_E2E_TASK30_MODE = if ($Task30Only) { "true" } else { "false" }
  $env:HUDDLETAB_E2E_TASK31_MODE = if ($Task31Only) { "true" } else { "false" }
  $env:HUDDLETAB_E2E_RELEASE_MODE = if ($ReleaseVerification) { "true" } else { "false" }
  $forwarded = New-Phase1EForwardedWslEnv
  $env:WSLENV = if ($originalWslEnv) { "$originalWslEnv`:$forwarded" } else { $forwarded }

  Write-Host "[2/10] 构建镜像、准备数据目录并启动独立生产 Compose（project=$composeProject, port=$appPort）"
  $composeAttempted = $true
  Invoke-Compose "build app" | Out-Null
  $prepareDataScriptWsl = ConvertTo-WslPath (Join-Path $repoDir "scripts/prepare-data-dir.sh")
  Invoke-Wsl -ArgumentList @("sh", $prepareDataScriptWsl, "--project-name", $composeProject) -Quiet | Out-Null
  Invoke-Compose "up -d --wait" | Out-Null
  Wait-Health $baseUrl
  if ($ReleaseVerification) {
    $entryHeaders = (Invoke-WebRequest -Uri "$baseUrl/" -UseBasicParsing).Headers
    $requiredHeaders = @{
      "Content-Security-Policy" = "default-src 'self'"
      "X-Content-Type-Options" = "nosniff"
      "X-Frame-Options" = "DENY"
      "Referrer-Policy" = "no-referrer"
      "Permissions-Policy" = "geolocation=(), camera=(), microphone=()"
    }
    foreach ($header in $requiredHeaders.Keys) {
      $actual = [string] $entryHeaders[$header]
      if ($header -eq "Content-Security-Policy") {
        if ($actual -notlike "*$($requiredHeaders[$header])*") { throw "生产入口缺少 CSP 安全头。" }
      } elseif ($actual -ne $requiredHeaders[$header]) {
        throw "生产入口安全头 $header 不符合预期。"
      }
    }
    $services = (Invoke-Compose "config --services" -Quiet).Output -split "\r?\n" | Where-Object { $_ }
    if ((@($services) -join ",") -ne "postgres,app") { throw "最终 Compose 服务必须严格为 postgres 与 app。" }
  }

  Write-Host "[3/10] 验证空库初始化引导、fresh migration 并通过 stdin bootstrap"
  if ($Task30Only -or $ReleaseVerification) {
    Push-Location $frontendDir
    try {
      $setupArguments = @("run", "test:e2e", "--", "setup.spec.ts", "--project=chromium-setup-desktop", "--project=chromium-setup-mobile")
      & npm @setupArguments
      if ($LASTEXITCODE -ne 0) { throw "空数据库初始化引导浏览器检查失败。" }
    } finally {
      Pop-Location
    }
  }
  $migration = Invoke-Compose "exec -T postgres psql -U huddletab -d huddletab -At" -InputText "SELECT count(*) FROM _sqlx_migrations WHERE success = true;`n" -Quiet
  if ($ReleaseVerification) {
    if ([int] $migration.Output.Trim() -ne 9) { throw "候选镜像 fresh migration 数量不是预期的 9 条。" }
  } elseif ([int] $migration.Output.Trim() -lt 3) { throw "fresh migration 未完整应用。" }
  # 一次性脚本整体从 stdin 执行，临时值不会进入主机命令行；CLI 的用户名回显也被丢弃。
  $bootstrapInput = @"
set -eu
username='$($env:HUDDLETAB_E2E_USERNAME)'
password='$($env:HUDDLETAB_E2E_PASSWORD)'
printf '%s\n' "`$password" | huddletab bootstrap-user --username "`$username" --password-stdin >/dev/null
"@
  $bootstrap = Invoke-Compose "exec -T app sh -s" -InputText $bootstrapInput -AllowFailure -Quiet
  if ($bootstrap.ExitCode -ne 0) {
    $safeBootstrapError = $bootstrap.Output
    foreach ($secret in @($env:HUDDLETAB_E2E_USERNAME, $env:HUDDLETAB_E2E_PASSWORD, $env:POSTGRES_PASSWORD)) {
      $safeBootstrapError = $safeBootstrapError.Replace($secret, "[REDACTED]")
    }
    throw "stdin bootstrap 失败：$safeBootstrapError"
  }
  $bootstrapInput = $null

  $matrixLabel = if ($Phase2Only) {
    "Phase 2 Chromium Desktop/Mobile、附件、通知/所有权与 WebKit smoke 矩阵"
  } elseif ($Task29Only) {
    "Task 29 Chromium Desktop/Mobile 管理矩阵"
  } elseif ($Task30Only) {
    "Task 30 Chromium Desktop/Mobile 初始化与分享矩阵"
  } elseif ($Task31Only) {
    "Task 31 Chromium Desktop/Mobile 系统信息矩阵"
  } elseif ($ReleaseVerification) {
    "最终 Release Verification 完整 Chromium/WebKit 矩阵（候选版本 0.0.3）"
  } elseif ($AttachmentOnly) {
    "Chromium Desktop/Mobile 附件矩阵"
  } elseif ($NotificationOwnershipOnly) {
    "Chromium Desktop/Mobile 通知与所有权矩阵"
  } else {
    "Chromium Desktop/Mobile 核心矩阵与 WebKit smoke"
  }
  Write-Host "[4/10] 运行 $matrixLabel"
  Push-Location $frontendDir
  try {
    $playwrightArguments = New-Phase1EPlaywrightArguments -AttachmentOnly $AttachmentOnly.IsPresent -NotificationOwnershipOnly $NotificationOwnershipOnly.IsPresent -Phase2Only $Phase2Only.IsPresent -Task29Only $Task29Only.IsPresent -Task30Only $Task30Only.IsPresent -Task31Only $Task31Only.IsPresent -ReleaseVerification $ReleaseVerification.IsPresent
    & npm @playwrightArguments
    $playwrightExitCode = $LASTEXITCODE
    node (Join-Path $PSScriptRoot "support/artifact-sanitizer.mjs") $artifactDir
    $sanitizerExitCode = $LASTEXITCODE
    if ($playwrightExitCode -ne 0 -and $sanitizerExitCode -ne 0) {
      throw "Playwright 验收失败，且 artifact 脱敏或扫描也失败。"
    }
    if ($sanitizerExitCode -ne 0) { throw "artifact 脱敏或扫描失败。" }
    if ($playwrightExitCode -ne 0) { throw "Playwright 验收失败，脱敏后的报告已留在 frontend/artifacts。" }
  } finally {
    Pop-Location
  }

  Write-Host "[5/10] 检查 summary/CSV 产物之外的生产 SPA 深链"
  $deepLink = Invoke-WebRequest -Uri "$baseUrl/activities/deep-link-release-check" -UseBasicParsing
  if ($deepLink.StatusCode -ne 200 -or $deepLink.Content -notmatch '<div id="root">') {
    throw "生产镜像没有正确回退 React SPA 深链。"
  }

  Write-Host "[6/10] 检查非 root UID 与运行镜像技术栈边界"
  $uid = (Invoke-Compose "exec -T app id -u" -Quiet).Output.Trim()
  if ($uid -ne "10001") { throw "运行容器 UID 不是预期的非 root 用户 10001。" }
  $runtimeCommands = Invoke-Compose "exec -T app sh -c '! command -v node >/dev/null 2>&1 && ! command -v npm >/dev/null 2>&1 && ! command -v npx >/dev/null 2>&1 && ! command -v next >/dev/null 2>&1'" -AllowFailure -Quiet
  $runtimeDirectories = Invoke-Compose "exec -T app sh -c 'find /app /usr/local -type d \( -name node_modules -o -name next -o -name drizzle-orm -o -name better-auth \) -print -quit'" -AllowFailure -Quiet
  if ($runtimeCommands.ExitCode -ne 0 -or $runtimeDirectories.ExitCode -ne 0 -or $runtimeDirectories.Output) {
    throw "运行镜像仍包含 Node/Next/Drizzle/Better Auth 运行时内容。"
  }

  Write-Host "[7/10] 验证 app 与 PostgreSQL 重启后的数据持久性"
  Invoke-Compose "restart app" -Quiet | Out-Null
  Wait-Health $baseUrl
  node (Join-Path $PSScriptRoot "support/persistence-check.mjs")
  if ($LASTEXITCODE -ne 0) { throw "app 重启持久性检查失败。" }
  Invoke-Compose "restart postgres app" -Quiet | Out-Null
  Wait-Health $baseUrl
  node (Join-Path $PSScriptRoot "support/persistence-check.mjs")
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL 重启持久性检查失败。" }

  Write-Host "[8/10] 验证数据库不可用时的中文冷启动错误"
  Invoke-Compose "stop app postgres" -Quiet | Out-Null
  $coldStart = Invoke-Compose "run --no-deps --rm app" -AllowFailure -Quiet
  if ($coldStart.ExitCode -eq 0) { throw "数据库不可用时 app 冷启动意外成功。" }
  if ($coldStart.Output -notmatch '无法连接 PostgreSQL，请检查 DATABASE_URL 和数据库状态') {
    throw "数据库不可用时未输出明确的中文冷启动错误。"
  }

  Write-Host "[9/10] 全部验收通过，准备执行限定范围清理"
} catch {
  $primaryFailure = $_
} finally {
  $cleanupFailure = $null
  try {
    Invoke-Phase1EComposeCleanup -ComposeAttempted $composeAttempted -Cleanup {
      $composeCleanup = Invoke-Compose "down --remove-orphans" -AllowFailure -Quiet
      if ($composeCleanup.ExitCode -ne 0) { throw "无法关闭本次 Phase 1E Compose project。" }
    }
    if ($temporaryData) {
      $resolvedForCleanup = (Invoke-Wsl -ArgumentList @("readlink", "-f", "--", $temporaryData) -AllowFailure -Quiet).Output.Trim()
      Assert-TemporaryPath $resolvedForCleanup
      # PostgreSQL 会把数据文件收紧为容器用户所有；用限定到本次 mount 的一次性 root 容器清空内容，再删除父目录。
      Invoke-Wsl -ArgumentList @("docker", "run", "--rm", "--user", "0", "--volume", "${resolvedForCleanup}:/cleanup", "postgres:18-alpine", "sh", "-c", "rm -rf /cleanup/* /cleanup/.[!.]* /cleanup/..?*") -Quiet | Out-Null
      Invoke-Wsl -ArgumentList @("rm", "-rf", "--", $resolvedForCleanup) -Quiet | Out-Null
      $remaining = Invoke-Wsl -ArgumentList @("test", "!", "-e", $resolvedForCleanup) -AllowFailure -Quiet
      if ($remaining.ExitCode -ne 0) { throw "WSL 临时目录清理后仍然存在。" }
      Write-Host "清理验证通过：本次 Compose 已关闭，限定前缀临时目录已删除；Windows 测试报告已保留。"
    }
  } catch {
    $cleanupFailure = $_
  }

  foreach ($name in $sensitiveNames) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
  Remove-Item Env:DATA_HOST_DIR, Env:APP_PORT, Env:APP_BASE_URL, Env:APP_VERSION, Env:HUDDLETAB_E2E_BASE_URL, Env:HUDDLETAB_E2E_ATTACHMENT_MODE, Env:HUDDLETAB_E2E_TASK29_MODE, Env:HUDDLETAB_E2E_TASK30_MODE, Env:HUDDLETAB_E2E_TASK31_MODE, Env:HUDDLETAB_E2E_RELEASE_MODE -ErrorAction SilentlyContinue
  if ($null -ne $originalAppVersion) { $env:APP_VERSION = $originalAppVersion }
  if ($null -ne $originalPostgresDb) { $env:POSTGRES_DB = $originalPostgresDb } else { Remove-Item Env:POSTGRES_DB -ErrorAction SilentlyContinue }
  $env:WSLENV = $originalWslEnv
}

Complete-Phase1EFailure -PrimaryFailure $primaryFailure -CleanupFailure $cleanupFailure
