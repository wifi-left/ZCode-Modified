# ZCode 桌面版（Windows）一键构建 / 打包脚本
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts\build-zcode-desktop-windows.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\build-zcode-desktop-windows.ps1 -SkipBuild
#   powershell -ExecutionPolicy Bypass -File scripts\build-zcode-desktop-windows.ps1 -Install
#
# 产物：packages\desktop\dist\ZCode-<version>-win-<arch>.exe（NSIS 安装包）
# 说明：
#   - 不会结束或修改正在运行的 ZCode 进程；-Install 会在检测到 ZCode 正在运行时直接拒绝。
#   - 安装包与已装版本共用 appId / 用户数据目录（%APPDATA%\ZCode）与单实例锁，
#     因此安装/运行前必须先退出正在运行的桌面版。
#   - -Install 默认打开交互式安装向导（可自选目录）；加 -Silent 且 -InstallDir 不含空格时才静默安装。

[CmdletBinding()]
param(
  [switch]$SkipBuild,
  [switch]$SkipPackage,
  [switch]$Install,
  [switch]$Silent,
  [string]$InstallDir = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$DesktopDir = Join-Path $RepoRoot "packages\desktop"
$DistDir = Join-Path $DesktopDir "dist"

function Write-Step([string]$Message) {
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Resolve-Command([string]$Name) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) { throw "未找到命令：$Name，请先安装并加入 PATH。" }
  return $command.Source
}

function Invoke-Pnpm([string[]]$Arguments) {
  $pnpm = Resolve-Command "pnpm"
  & $pnpm @Arguments
  if ($LASTEXITCODE -ne 0) { throw "pnpm $($Arguments -join ' ') 失败（exit $LASTEXITCODE）" }
}

Write-Step "检查工具链"
$node = Resolve-Command "node"
$nodeVersion = (& $node -p "process.versions.node").Trim()
$nodeMajor = [int]($nodeVersion.Split(".")[0])
if ($nodeMajor -lt 24) {
  throw "需要 Node.js >= 24，当前为 v$nodeVersion。"
}
Write-Host "    Node v$nodeVersion"
Resolve-Command "pnpm" | Out-Null

if (-not $SkipBuild) {
  Write-Step "构建桌面版（生产渲染包 + 仓库内运行时资源）"
  Write-Host "    首次构建会准备 runtime assets，耗时数分钟。"
  Push-Location $RepoRoot
  try {
    Invoke-Pnpm @("--filter", "@zcode/desktop", "build")
  } finally {
    Pop-Location
  }
} else {
  Write-Host "    跳过构建（-SkipBuild）"
}

if (-not $SkipPackage) {
  Write-Step "使用 electron-builder 打包 Windows NSIS 安装包"
  Push-Location $DesktopDir
  try {
    & (Resolve-Command "pnpm") "exec" "electron-builder" "--config" "electron-builder.config.js" "--win" "--x64"
    if ($LASTEXITCODE -ne 0) { throw "electron-builder 打包失败（exit $LASTEXITCODE）" }
  } finally {
    Pop-Location
  }
} else {
  Write-Host "    跳过打包（-SkipPackage）"
}

$installers = @()
if (Test-Path $DistDir) {
  $installers = Get-ChildItem -Path $DistDir -Filter "*-win-*.exe" -File |
    Where-Object { $_.Name -notmatch "uninstaller|blockmap" } |
    Sort-Object LastWriteTime -Descending
}

if ($installers.Count -eq 0) {
  throw "未在 $DistDir 找到 Windows 安装包（*-win-*.exe）。"
}

$installer = $installers[0]
Write-Host ""
Write-Host "安装包：$($installer.FullName)" -ForegroundColor Green
Write-Host "大小： $([math]::Round($installer.Length / 1MB, 1)) MB"
Write-Host ""

if (-not $Install) {
  Write-Host "下一步（需要退出正在运行的桌面版后手动执行）："
  Write-Host "  1. 关闭 D:\ZCode\ZCode.exe（以及托盘中的 ZCode 进程）"
  Write-Host "  2. 运行安装包，或重跑本脚本并加 -Install"
  Write-Host "注意：安装包与旧版共用 %APPDATA%\ZCode 数据目录与单实例锁，不能同时运行两个版本。"
  exit 0
}

Write-Step "检查正在运行的桌面版"
$running = Get-Process -Name "ZCode" -ErrorAction SilentlyContinue
if ($running) {
  throw "检测到 ZCode 正在运行（PID: $($running.Id -join ', ')）。请先退出应用再重试；本脚本不会结束你的进程。"
}

$arguments = @()
if ($Silent) {
  if (-not $InstallDir) {
    throw "-Silent 需要显式指定 -InstallDir（例如 D:\ZCode）。"
  }
  if ($InstallDir -match "\s") {
    throw "NSIS 静默安装的 -InstallDir 不能包含空格。请改用交互式安装（去掉 -Silent）。"
  }
  $arguments = @("/S", "/D=$InstallDir")
  Write-Step "静默安装到 $InstallDir"
} else {
  Write-Step "启动交互式安装向导"
}

$process = Start-Process -FilePath $installer.FullName -ArgumentList $arguments -Wait -PassThru
if ($process.ExitCode -ne 0) {
  throw "安装程序退出码 $($process.ExitCode)（0 = 成功，常见非零为 1223 用户取消）。"
}
Write-Host ""
Write-Host "桌面版安装完成。" -ForegroundColor Green
Write-Host "提示：桌面版与 CLI 共享 %USERPROFILE%\.zcode 配置；新版本构建包含本次的微信 Bot 增强与长上下文渲染优化。"
