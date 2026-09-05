<##
  HuddleTab Rust 新栈最终自动化发布门禁。
  该入口故意不接受 Compose 文件、测试路径或版本参数；它只验证固定的 0.0.4 候选，
  不创建 Git tag、不登录 GHCR、不推送镜像。真机 iPhone 验收仍需部署者单独完成。
##>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoDir = Split-Path -Parent $PSScriptRoot
$frontendDir = Join-Path $repoDir "frontend"
$serverManifest = Join-Path $repoDir "server/Cargo.toml"
$temporaryContractDir = $null
$databaseContainer = $null
$databasePort = $null
$savedEnvironment = @{}
$originalWslEnv = $env:WSLENV

function Invoke-Checked {
  param(
    [Parameter(Mandatory)] [string] $Name,
    [Parameter(Mandatory)] [scriptblock] $Action
  )

  Write-Host "[release] $Name"
  & $Action
  if ($LASTEXITCODE -ne 0) { throw "[$Name] 命令失败，退出码：$LASTEXITCODE。" }
}

function Invoke-WslChecked {
  param(
    [Parameter(Mandatory)] [string[]] $Arguments,
    [string] $Name = "WSL 命令"
  )

  & wsl.exe -d Debian -- @Arguments
  if ($LASTEXITCODE -ne 0) { throw "[$Name] WSL 命令失败，退出码：$LASTEXITCODE。" }
}

function Get-AvailablePort {
  $listener = [System.Net.Sockets.TcpListener]::new(
    [System.Net.IPAddress]::Loopback,
    0
  )
  $listener.Start()
  try { return ([System.Net.IPEndPoint] $listener.LocalEndpoint).Port }
  finally { $listener.Stop() }
}

function ConvertTo-WslPath {
  param([Parameter(Mandatory)] [string] $WindowsPath)
  $fullPath = [System.IO.Path]::GetFullPath($WindowsPath)
  if ($fullPath -notmatch '^([A-Za-z]):\\(.*)$') {
    throw "最终 Release Verification 只接受带盘符的 Windows 仓库路径。"
  }
  return "/mnt/$($Matches[1].ToLowerInvariant())/$($Matches[2].Replace('\', '/'))"
}

function Set-TemporaryEnvironment {
  param([Parameter(Mandatory)] [string] $Name, [Parameter(Mandatory)] [string] $Value)
  $savedEnvironment[$Name] = [Environment]::GetEnvironmentVariable($Name)
  [Environment]::SetEnvironmentVariable($Name, $Value)
}

function Assert-TrackedTreeIsClean {
  $status = (& git -C $repoDir status --porcelain)
  if ($LASTEXITCODE -ne 0) { throw "无法读取 Git 工作区状态。" }
  if ($status) { throw "最终 Release Verification 必须在干净 Git 工作区执行。" }

  $tracked = @(& git -C $repoDir ls-files)
  $unsafe = @($tracked | Where-Object {
      $_ -match '(^|/)(\.env|data/|frontend/artifacts/|frontend/dist/|server/target/)' -and
      $_ -ne ".env.example"
    })
  if ($unsafe.Count -gt 0) {
    throw "Git 仍跟踪不应进入发布提交的凭据、数据或构建产物：$($unsafe -join ', ')"
  }
}

function Start-DisposablePostgres {
  $script:databaseContainer = "huddletab-release-db-$([Guid]::NewGuid().ToString('N').Substring(0, 12))"
  $script:databasePort = Get-AvailablePort
  $password = [Guid]::NewGuid().ToString("N") + "Pg1!"
  Set-TemporaryEnvironment -Name "POSTGRES_USER" -Value "huddletab"
  Set-TemporaryEnvironment -Name "POSTGRES_DB" -Value "huddletab_test"
  Set-TemporaryEnvironment -Name "POSTGRES_PASSWORD" -Value $password
  Set-TemporaryEnvironment -Name "TEST_DATABASE_URL" -Value "postgresql://huddletab:${password}@127.0.0.1:${databasePort}/huddletab_test"
  $env:WSLENV = "POSTGRES_USER:POSTGRES_DB:POSTGRES_PASSWORD"

  Invoke-WslChecked -Name "启动可丢弃 PostgreSQL" -Arguments @(
    "docker", "run", "--detach", "--name", $databaseContainer,
    "--publish", "127.0.0.1:${databasePort}:5432",
    "--env", "POSTGRES_USER", "--env", "POSTGRES_DB", "--env", "POSTGRES_PASSWORD",
    "postgres:18-alpine"
  )

  for ($attempt = 1; $attempt -le 60; $attempt++) {
    $ready = (& wsl.exe -d Debian -- docker exec $databaseContainer pg_isready -U huddletab -d huddletab_test 2>$null)
    if ($LASTEXITCODE -eq 0) { return }
    Start-Sleep -Seconds 1
  }
  throw "可丢弃 PostgreSQL 在等待期内未就绪。"
}

function Stop-DisposablePostgres {
  if (-not $databaseContainer) { return }
  if ($databaseContainer -notmatch '^huddletab-release-db-[a-f0-9]{12}$') {
    throw "拒绝清理未通过固定前缀校验的 PostgreSQL 容器。"
  }
  & wsl.exe -d Debian -- docker rm --force -- $databaseContainer 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "无法清理本次 Release Verification PostgreSQL 容器。" }
  $script:databaseContainer = $null
}

function Compare-FilesExactly {
  param([Parameter(Mandatory)] [string] $Left, [Parameter(Mandatory)] [string] $Right)
  # 生成器在 Windows 与 WSL 之间可能使用不同换行符；合同内容比较不应受 CRLF/LF 影响。
  $leftText = ([System.IO.File]::ReadAllText($Left)).Replace("`r`n", "`n")
  $rightText = ([System.IO.File]::ReadAllText($Right)).Replace("`r`n", "`n")
  if ($leftText -cne $rightText) {
    throw "生成文件与仓库文件存在差异：$Left <> $Right"
  }
}

try {
  Assert-TrackedTreeIsClean
  $repoWslPath = ConvertTo-WslPath $repoDir

  Invoke-Checked "Rust fmt" { cargo fmt --manifest-path $serverManifest --all -- --check }
  Invoke-Checked "Rust 严格 Clippy" { cargo clippy --manifest-path $serverManifest --all-targets --all-features -- -D warnings }
  Invoke-Checked "Rust 非数据库全量测试" { cargo test --manifest-path $serverManifest --all-targets --all-features -- --test-threads=1 }

  Start-DisposablePostgres
  Invoke-Checked "Rust PostgreSQL 全量测试（84 个 ignored，用例串行）" { cargo test --manifest-path $serverManifest --all-targets --all-features -- --ignored --test-threads=1 }

  # Node 的 OpenAPI resolver 在中文用户目录下会把临时路径编码成字面量 `%E...`；
  # 固定使用 ASCII 临时根目录，避免生成合同时误判为文件不存在。
  $temporaryContractDir = Join-Path "C:\Temp" "huddletab-release-$([Guid]::NewGuid().ToString('N'))"
  if ($temporaryContractDir -notmatch '^C:\\Temp\\huddletab-release-[a-f0-9]{32}$') { throw "临时合同目录未通过固定前缀校验。" }
  New-Item -ItemType Directory -Force -Path "C:\Temp" | Out-Null
  New-Item -ItemType Directory -Force -Path $temporaryContractDir | Out-Null
  $temporaryOpenapi = Join-Path $temporaryContractDir "openapi.json"
  $temporaryClient = Join-Path $temporaryContractDir "openapi.ts"
  Invoke-Checked "OpenAPI 临时生成" { cargo run --manifest-path $serverManifest -- openapi --output $temporaryOpenapi }
  Compare-FilesExactly $temporaryOpenapi (Join-Path $repoDir "contracts/openapi.json")
  Invoke-Checked "Frontend dependencies" { npm --prefix $frontendDir ci }
  $openapiCli = Join-Path $frontendDir "node_modules/.bin/openapi-typescript.cmd"
  if (-not (Test-Path $openapiCli)) { throw "未找到 frontend OpenAPI 生成器，请先安装 frontend 依赖。" }
  Invoke-Checked "TypeScript client 临时生成" { & $openapiCli $temporaryOpenapi -o $temporaryClient }
  Compare-FilesExactly $temporaryClient (Join-Path $frontendDir "src/api/generated/openapi.ts")

  Invoke-Checked "Frontend 全量单测" { npm --prefix $frontendDir run test:unit }
  Invoke-Checked "Frontend typecheck" { npm --prefix $frontendDir run typecheck }
  Invoke-Checked "Frontend production build" { npm --prefix $frontendDir run build }
  Invoke-Checked "runner 安全测试" { pwsh -NoProfile -File (Join-Path $frontendDir "e2e/support/run-phase1e-safety.test.ps1") }
  Invoke-Checked "数据目录权限安全测试" { wsl.exe -d Debian -- sh -lc "cd '$repoWslPath' && sh frontend/e2e/support/data-directory-permissions.test.sh" }
  Invoke-Checked "完整候选镜像与浏览器矩阵" { & (Join-Path $frontendDir "e2e/run-phase1e.ps1") -ReleaseVerification }
  Invoke-Checked "Git diff whitespace 检查" { git -C $repoDir diff --check }

  Write-Host "[release] 自动化门禁通过：0.0.4 候选镜像已完成 Rust、PostgreSQL、Frontend、Compose 与浏览器验收。"
  Write-Host "[release] 真实 iPhone Safari/Home Screen PWA 验收未执行，已记录为本次发布例外；本次未创建 tag、未推送 GHCR。"
} finally {
  try { Stop-DisposablePostgres } catch { Write-Error $_ }
  if ($temporaryContractDir -and (Test-Path $temporaryContractDir)) {
    if ($temporaryContractDir -notmatch '^C:\\Temp\\huddletab-release-[a-f0-9]{32}$') { throw "拒绝清理未通过前缀校验的合同临时目录。" }
    Remove-Item -LiteralPath $temporaryContractDir -Recurse -Force
  }
  foreach ($entry in $savedEnvironment.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value)
  }
  $env:WSLENV = $originalWslEnv
}
