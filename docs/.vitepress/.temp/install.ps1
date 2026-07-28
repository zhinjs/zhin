# Zhin.js Installer
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Continue"
# Zhin.js 一键安装脚本 (PowerShell 版本)

# ─── 颜色输出函数 ───

function Print-Banner {
    Write-Host ""
    Write-Host "  ______  _     _           _      " -ForegroundColor Cyan
    Write-Host " |___  / | |   (_)         (_)     " -ForegroundColor Cyan
    Write-Host "    / /  | |__  _ _ __      _ ___  " -ForegroundColor Cyan
    Write-Host "   / /   | '_ \| | '_ \   | / __| " -ForegroundColor Cyan
    Write-Host "  / /__  | | | | | | | |  | \__ \ " -ForegroundColor Cyan
    Write-Host " /_____| |_| |_|_|_| |_|  | |___/ " -ForegroundColor Cyan
    Write-Host "                          _/ |     " -ForegroundColor Cyan
    Write-Host "                         |__/      " -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Zhin.js - 现代化 TypeScript 聊天机器人框架" -ForegroundColor Blue
    Write-Host "  https://github.com/zhinjs/zhin" -ForegroundColor Blue
    Write-Host ""
}

function Log-Info {
    param([string]$Message)
    Write-Host "ℹ " -ForegroundColor Blue -NoNewline
    Write-Host $Message
}

function Log-Success {
    param([string]$Message)
    Write-Host "✓ " -ForegroundColor Green -NoNewline
    Write-Host $Message
}

function Log-Warn {
    param([string]$Message)
    Write-Host "⚠ " -ForegroundColor Yellow -NoNewline
    Write-Host $Message
}

function Log-Error {
    param([string]$Message)
    Write-Host "✗ " -ForegroundColor Red -NoNewline
    Write-Host $Message
}

# ─── 检查命令是否存在 ───

function Test-CommandExists {
    param([string]$Command)
    $null -ne (Get-Command $Command -ErrorAction SilentlyContinue)
}

# ─── 版本比较: 返回 $true 如果 $Version1 >= $Version2 ───

function Test-VersionGte {
    param(
        [string]$Version1,
        [string]$Version2
    )
    [version]$Version1 -ge [version]$Version2
}

# ─── 检查 Node.js ───

function Test-Node {
    if (-not (Test-CommandExists "node")) {
        Log-Error "未检测到 Node.js"
        Write-Host ""
        Write-Host "请先安装 Node.js >= 20.19.0 或 >= 22.12.0："
        Write-Host ""
        Write-Host "  方式 1 - 使用 nvm-windows（推荐）:"
        Write-Host "    https://github.com/coreybutler/nvm-windows/releases" -ForegroundColor Cyan
        Write-Host "    nvm install 22" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "  方式 2 - 官方安装包:"
        Write-Host "    https://nodejs.org/zh-cn/download" -ForegroundColor Cyan
        Write-Host ""
        exit 1
    }

    $nodeVersionRaw = (node -v) -replace '^v', ''

    # 检查版本: >= 20.19.0 或 >= 22.12.0
    if (Test-VersionGte $nodeVersionRaw "22.12.0") {
        Log-Success "Node.js v${nodeVersionRaw} ✓"
        return
    }
    elseif (Test-VersionGte $nodeVersionRaw "20.19.0") {
        # 检查不是 21.x（因为 21 < 22.12）
        $major = [int]($nodeVersionRaw.Split('.')[0])
        if ($major -eq 20 -or $major -ge 22) {
            Log-Success "Node.js v${nodeVersionRaw} ✓"
            return
        }
    }

    Log-Error "Node.js 版本过低: v${nodeVersionRaw}"
    Write-Host "  需要 >= 20.19.0 或 >= 22.12.0"
    Write-Host "  建议运行: nvm install 22"
    exit 1
}

# ─── 检查并安装 pnpm ───

function Test-Pnpm {
    if (Test-CommandExists "pnpm") {
        $pnpmVersion = (pnpm -v 2>&1) | Out-String
        $pnpmVersion = $pnpmVersion.Trim()
        Log-Success "pnpm v${pnpmVersion} ✓"
        return
    }

    Log-Warn "未检测到 pnpm，正在安装..."

    # 优先使用 corepack
    $corepackOk = $false
    if (Test-CommandExists "corepack") {
        Log-Info "通过 corepack 安装 pnpm..."
        corepack enable 2>&1 | Out-Null
        corepack prepare pnpm@latest --activate 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            $corepackOk = $true
        } else {
            Log-Warn "corepack 安装失败，尝试 npm 安装..."
        }
    }

    if (-not $corepackOk) {
        Log-Info "通过 npm 安装 pnpm..."
        npm install -g pnpm 2>&1 | Out-Null
    }

    # 刷新环境变量以检测新安装的 pnpm
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

    if (Test-CommandExists "pnpm") {
        $pnpmVersion = (pnpm -v 2>&1) | Out-String
        $pnpmVersion = $pnpmVersion.Trim()
        Log-Success "pnpm v${pnpmVersion} 安装成功 ✓"
    }
    else {
        Log-Error "pnpm 安装失败"
        Write-Host "  请手动安装: npm install -g pnpm"
        exit 1
    }
}

# ─── 主流程 ───

function Main {
    Print-Banner

    Log-Info "正在检查环境..."
    Write-Host ""

    Test-Node
    Test-Pnpm

    Write-Host ""
    Log-Info "正在启动 Zhin.js 脚手架..."
    Write-Host ""

    # 透传所有参数给 create-zhin-app
    pnpm create zhin-app @args
}

Main @args
