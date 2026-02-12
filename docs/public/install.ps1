#Requires -Version 5.1
<#
.SYNOPSIS
  Zhin.js 一键安装脚本 (Windows PowerShell)
.DESCRIPTION
  检查 Node.js 和 pnpm 环境，然后启动 create-zhin-app 脚手架
.EXAMPLE
  irm https://zhin.js.org/install.ps1 | iex
  irm https://zhin.js.org/install.ps1 | iex -Args "my-bot"
  irm https://zhin.js.org/install.ps1 | iex -Args "my-bot","-y"
#>

$ErrorActionPreference = "Stop"

function Write-Banner {
  Write-Host ""
  Write-Host "  ______  _     _           _        " -ForegroundColor Cyan
  Write-Host " |___  / | |   (_)         (_)       " -ForegroundColor Cyan
  Write-Host "    / /  | |__  _ _ __      _    ___ " -ForegroundColor Cyan
  Write-Host "   / /   | '_ \| | '_ \    | | / __| " -ForegroundColor Cyan
  Write-Host "  / /__  | | | | | | | |   | | \__ \ " -ForegroundColor Cyan
  Write-Host " /_____| |_| |_|_|_| |_|   | | |___/ " -ForegroundColor Cyan
  Write-Host "                          _/ |      " -ForegroundColor Cyan
  Write-Host "                         |__/       " -ForegroundColor Cyan
  Write-Host ""
  Write-Host "  Zhin.js - AI 驱动的 TypeScript 聊天机器人框架" -ForegroundColor Blue
  Write-Host "  https://github.com/zhinjs/zhin" -ForegroundColor Blue
  Write-Host ""
}

function Write-LogInfo($msg)    { Write-Host "i " -NoNewline -ForegroundColor Blue;    Write-Host $msg }
function Write-LogSuccess($msg) { Write-Host "✓ " -NoNewline -ForegroundColor Green;   Write-Host $msg }
function Write-LogWarn($msg)    { Write-Host "⚠ " -NoNewline -ForegroundColor Yellow;  Write-Host $msg }
function Write-LogError($msg)   { Write-Host "✗ " -NoNewline -ForegroundColor Red;     Write-Host $msg }

function Test-Command($cmd) {
  return [bool](Get-Command $cmd -ErrorAction SilentlyContinue)
}

# 比较版本号: 返回 $true 如果 $v1 >= $v2
function Test-VersionGte($v1, $v2) {
  $a = $v1.Split('.') | ForEach-Object { [int]$_ }
  $b = $v2.Split('.') | ForEach-Object { [int]$_ }
  for ($i = 0; $i -lt 3; $i++) {
    $va = if ($i -lt $a.Count) { $a[$i] } else { 0 }
    $vb = if ($i -lt $b.Count) { $b[$i] } else { 0 }
    if ($va -gt $vb) { return $true }
    if ($va -lt $vb) { return $false }
  }
  return $true
}

function Test-NodeVersion {
  if (-not (Test-Command "node")) {
    Write-LogError "未检测到 Node.js"
    Write-Host ""
    Write-Host "请先安装 Node.js >= 20.19.0 或 >= 22.12.0：" 
    Write-Host ""
    Write-Host "  方式 1 - 使用 fnm（推荐）:" 
    Write-Host "    winget install Schniz.fnm" -ForegroundColor Cyan
    Write-Host "    fnm install 22" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  方式 2 - 使用 winget:"
    Write-Host "    winget install OpenJS.NodeJS.LTS" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  方式 3 - 官方安装包:"
    Write-Host "    https://nodejs.org/zh-cn/download" -ForegroundColor Cyan
    Write-Host ""
    exit 1
  }

  $raw = (node -v).Trim()
  $nodeVersion = $raw -replace '^v', ''
  $major = [int]($nodeVersion.Split('.')[0])

  $ok = $false
  if ($major -ge 22 -and (Test-VersionGte $nodeVersion "22.12.0")) { $ok = $true }
  if ($major -eq 20 -and (Test-VersionGte $nodeVersion "20.19.0")) { $ok = $true }

  if ($ok) {
    Write-LogSuccess "Node.js v$nodeVersion"
  } else {
    Write-LogError "Node.js 版本不满足要求: v$nodeVersion"
    Write-Host "  需要 ^20.19.0 或 >=22.12.0"
    Write-Host "  建议运行: fnm install 22"
    exit 1
  }
}

function Test-PnpmVersion {
  if (Test-Command "pnpm") {
    $pnpmVersion = (pnpm -v 2>$null).Trim()
    Write-LogSuccess "pnpm v$pnpmVersion"
    return
  }

  Write-LogWarn "未检测到 pnpm，正在安装..."

  if (Test-Command "corepack") {
    Write-LogInfo "通过 corepack 安装 pnpm..."
    try {
      corepack enable 2>$null
      corepack prepare pnpm@latest --activate 2>$null
    } catch {
      Write-LogWarn "corepack 安装失败，尝试 npm 安装..."
      npm install -g pnpm
    }
  } else {
    Write-LogInfo "通过 npm 安装 pnpm..."
    npm install -g pnpm
  }

  if (Test-Command "pnpm") {
    $pnpmVersion = (pnpm -v 2>$null).Trim()
    Write-LogSuccess "pnpm v$pnpmVersion 安装成功"
  } else {
    Write-LogError "pnpm 安装失败"
    Write-Host "  请手动安装: npm install -g pnpm"
    exit 1
  }
}

# ---- 主流程 ----
Write-Banner
Write-LogInfo "正在检查环境... (Windows $([System.Environment]::OSVersion.Version))"
Write-Host ""

Test-NodeVersion
Test-PnpmVersion

Write-Host ""
Write-LogInfo "正在启动 Zhin.js 脚手架..."
Write-Host ""

pnpm create zhin-app @args
