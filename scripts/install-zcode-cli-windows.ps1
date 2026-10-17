<#
.SYNOPSIS
  ZCode CLI 一键安装脚本（Windows）。

.DESCRIPTION
  从本仓库源码构建 CLI 发行包（pnpm build:zcode），安装到独立目录并生成 zcode.cmd 启动器。

  安全约定（"不打扰"）：
  - 只写入 -InstallDir（默认 %USERPROFILE%\.zcode-local）与用户级 PATH；
  - 不触碰正在运行的桌面版 D:\ZCode、%APPDATA%\ZCode，也不写 %USERPROFILE%\.zcode 数据目录
    （新安装的 CLI 在运行时会像正常 ZCode 一样读取该数据目录，但安装过程不做任何改动）；
  - 不结束任何进程，不重启任何应用。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/install-zcode-cli-windows.ps1
.EXAMPLE
  # 已经构建过 dist/zcode 时跳过构建：
  powershell -ExecutionPolicy Bypass -File scripts/install-zcode-cli-windows.ps1 -SkipBuild
#>
[CmdletBinding()]
param(
  [string]$InstallDir = (Join-Path $env:USERPROFILE ".zcode-local"),
  [string]$BinDir,
  [string]$BaseUrl = "http://127.0.0.1:8080/zcode/",
  [switch]$SkipBuild,
  [switch]$NoPath
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Warn([string]$Message) {
  Write-Host "!!  $Message" -ForegroundColor Yellow
}

function Fail([string]$Message) {
  Write-Host "xx  $Message" -ForegroundColor Red
  exit 1
}

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $BinDir) {
  $BinDir = Join-Path $InstallDir "bin"
}
$DistDir = Join-Path $RepoRoot "dist\zcode"

# ---------------------------------------------------------------------------
# 1. 环境检查
# ---------------------------------------------------------------------------
Write-Step "检查 Node.js"
$nodeVersion = (& node --version) 2>$null
if (-not $nodeVersion) {
  Fail "未找到 node。请先安装 Node.js 24+（https://nodejs.org/）后重试。"
}
$nodeMajor = [int]($nodeVersion.TrimStart("v").Split(".")[0])
if ($nodeMajor -lt 24) {
  Fail "Node.js 版本过低：$nodeVersion（需要 24+）。"
}
Write-Host "    Node $nodeVersion"

# ---------------------------------------------------------------------------
# 2. 构建发行包
# ---------------------------------------------------------------------------
if (-not $SkipBuild) {
  Write-Step "构建 CLI 发行包（pnpm build:zcode）"
  if (-not (Test-Path (Join-Path $RepoRoot "node_modules"))) {
    Write-Step "首次构建：安装依赖（pnpm install，可能需要几分钟）"
    $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
    $env:ELECTRON_SKIP_BINARY_DOWNLOAD = "1"
    $env:HUSKY = "0"
    Push-Location $RepoRoot
    try {
      & pnpm install
      if ($LASTEXITCODE -ne 0) { Fail "pnpm install 失败（exit $LASTEXITCODE）。" }
    } finally {
      Pop-Location
    }
  }
  Push-Location $RepoRoot
  try {
    & pnpm build:zcode --base-url $BaseUrl
    if ($LASTEXITCODE -ne 0) { Fail "pnpm build:zcode 失败（exit $LASTEXITCODE）。" }
  } finally {
    Pop-Location
  }
}

$latestJson = Join-Path $DistDir "latest.json"
if (-not (Test-Path $latestJson)) {
  Fail "未找到 $latestJson。请先运行 pnpm build:zcode（或去掉 -SkipBuild）。"
}

# ---------------------------------------------------------------------------
# 3. 安装到独立目录
# ---------------------------------------------------------------------------
$latest = Get-Content $latestJson -Raw | ConvertFrom-Json
$version = $latest.version
$tarball = Join-Path $DistDir ("releases\{0}\{1}" -f $version, $latest.tarball)
if (-not (Test-Path $tarball)) {
  Fail "未找到发行压缩包 $tarball。"
}

Write-Step "安装 ZCode CLI $version 到 $InstallDir"
$releaseDir = Join-Path $InstallDir ("releases\{0}" -f $version)
$stagingDir = Join-Path $InstallDir ".staging-$([guid]::NewGuid().ToString('N'))"

New-Item -ItemType Directory -Force -Path $stagingDir | Out-Null
try {
  # 用系统自带 bsdtar（Windows 10 1803+）。Git 附带的 GNU tar 会把 F: 盘符当成 rsh 主机，
  # 报 "Cannot connect to F: resolve failed"，所以显式指定 System32 下的 tar.exe。
  $tarExe = Join-Path $env:SystemRoot ("System32" + [char]92 + "tar.exe")
  if (-not (Test-Path $tarExe)) { $tarExe = "tar" }
  & $tarExe -xzf $tarball -C $stagingDir
  if ($LASTEXITCODE -ne 0) { Fail "解压失败（exit $LASTEXITCODE）。" }

  $extracted = Join-Path $stagingDir "zcode"
  if (-not (Test-Path (Join-Path $extracted "bin\zcode.mjs"))) {
    Fail "发行包结构异常：缺少 bin\zcode.mjs。"
  }

  New-Item -ItemType Directory -Force -Path (Split-Path $releaseDir) | Out-Null
  if (Test-Path $releaseDir) { Remove-Item -Recurse -Force $releaseDir }
  Move-Item -Path $extracted -Destination $releaseDir
} finally {
  Remove-Item -Recurse -Force $stagingDir -ErrorAction SilentlyContinue
}

# current 指向本次版本（junction，需要时重建）
$currentDir = Join-Path $InstallDir "current"
if (Test-Path $currentDir) {
  # Remove-Item 对 junction 只删除链接本身，不影响目标目录。
  (Get-Item $currentDir).Delete()
}
New-Item -ItemType Junction -Path $currentDir -Target $releaseDir | Out-Null

# ---------------------------------------------------------------------------
# 4. 生成启动器
# ---------------------------------------------------------------------------
Write-Step "生成启动器 $BinDir\zcode.cmd"
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
$shimPath = Join-Path $BinDir "zcode.cmd"
$shim = @(
  "@echo off",
  "setlocal",
  "node `"%~dp0..\current\bin\zcode.mjs`" %*",
  "exit /b %ERRORLEVEL%"
) -join "`r`n"
Set-Content -Path $shimPath -Value $shim -Encoding ASCII

if (-not $NoPath) {
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $entries = @()
  if ($userPath) { $entries = $userPath.Split(";") | Where-Object { $_ -ne "" } }
  if ($entries -notcontains $BinDir) {
    $newPath = (@($entries) + $BinDir) -join ";"
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Write-Host "    已把 $BinDir 追加到用户级 PATH（新开的终端生效）"
  } else {
    Write-Host "    $BinDir 已在用户级 PATH 中"
  }
}

# ---------------------------------------------------------------------------
# 5. 自检
# ---------------------------------------------------------------------------
Write-Step "自检：node current\bin\zcode.mjs --version"
$installedVersion = & node (Join-Path $currentDir "bin\zcode.mjs") --version
if ($LASTEXITCODE -ne 0) { Fail "自检失败：安装的 CLI 无法运行。" }

Write-Host ""
Write-Host "ZCode CLI $installedVersion 安装完成。" -ForegroundColor Green
Write-Host "  启动器： $shimPath"
Write-Host "  安装目录：$InstallDir（releases\<version> + current 链接）"
Write-Host ""
Write-Host "使用方式：新开一个终端执行  zcode  （TUI）或  zcode --web  （浏览器界面）。"
Write-Host "说明："
Write-Host "  - 运行时会读取与桌面版共享的数据目录 %USERPROFILE%\.zcode（产品设计如此）；"
Write-Host "  - 本脚本未修改运行中的桌面版（D:\ZCode）与 %APPDATA%\ZCode；"
Write-Host "  - 卸载：删除 $InstallDir 并从用户 PATH 移除 $BinDir 即可。"
