#!/usr/bin/env bash
# Zhin.js 一键安装脚本
# 支持平台: macOS, Linux, WSL
# 使用方法:
#   curl -fsSL https://zhin.js.org/install.sh | bash
#   curl -fsSL https://zhin.js.org/install.sh | bash -s -- my-bot
#   curl -fsSL https://zhin.js.org/install.sh | bash -s -- my-bot -y
#
# Windows 用户请使用 PowerShell 版本:
#   irm https://zhin.js.org/install.ps1 | iex

set -eo pipefail

# ---- 颜色（自动检测终端是否支持） ----
if [ -t 1 ] && [ -n "${TERM-}" ] && [ "${TERM-}" != "dumb" ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  BLUE='\033[0;34m'
  CYAN='\033[0;36m'
  NC='\033[0m'
else
  RED='' GREEN='' YELLOW='' BLUE='' CYAN='' NC=''
fi

print_banner() {
  echo ""
  echo -e "${CYAN}  ______  _     _           _      ${NC}"
  echo -e "${CYAN} |___  / | |   (_)         (_)     ${NC}"
  echo -e "${CYAN}    / /  | |__  _ _ __      _ ___  ${NC}"
  echo -e "${CYAN}   / /   | '_ \\| | '_ \\   | / __| ${NC}"
  echo -e "${CYAN}  / /__  | | | | | | | |  | \\__ \\ ${NC}"
  echo -e "${CYAN} /_____| |_| |_|_|_| |_|  | |___/ ${NC}"
  echo -e "${CYAN}                          _/ |     ${NC}"
  echo -e "${CYAN}                         |__/      ${NC}"
  echo ""
  echo -e "${BLUE}  Zhin.js - AI 驱动的 TypeScript 聊天机器人框架${NC}"
  echo -e "${BLUE}  https://github.com/zhinjs/zhin${NC}"
  echo ""
}

log_info()    { echo -e "${BLUE}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warn()    { echo -e "${YELLOW}⚠${NC} $1"; }
log_error()   { echo -e "${RED}✗${NC} $1"; }

command_exists() { command -v "$1" >/dev/null 2>&1; }

# ---- 纯 bash 版本比较（不依赖 sort -V） ----
# 返回 0 如果 $1 >= $2（支持 x.y.z 三段版本号）
version_gte() {
  local IFS='.'
  local i a b
  read -ra a <<< "$1"
  read -ra b <<< "$2"
  for i in 0 1 2; do
    local va=${a[$i]:-0}
    local vb=${b[$i]:-0}
    if (( va > vb )); then return 0; fi
    if (( va < vb )); then return 1; fi
  done
  return 0
}

# ---- 检测操作系统 ----
detect_os() {
  local os
  os="$(uname -s)"
  case "$os" in
    Linux*)  echo "linux" ;;
    Darwin*) echo "macos" ;;
    MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
    *)       echo "unknown" ;;
  esac
}

# ---- 检查 Node.js ----
check_node() {
  if ! command_exists node; then
    log_error "未检测到 Node.js"
    echo ""
    local os
    os=$(detect_os)
    echo "请先安装 Node.js >= 20.19.0 或 >= 22.12.0："
    echo ""
    echo "  方式 1 - 使用 nvm（推荐）:"
    echo -e "    ${CYAN}curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash${NC}"
    echo -e "    ${CYAN}nvm install 22${NC}"
    echo ""
    if [ "$os" = "macos" ]; then
      echo "  方式 2 - 使用 Homebrew:"
      echo -e "    ${CYAN}brew install node@22${NC}"
      echo ""
    fi
    echo "  方式 3 - 官方安装包:"
    echo -e "    ${CYAN}https://nodejs.org/zh-cn/download${NC}"
    echo ""
    exit 1
  fi

  local node_version
  node_version=$(node -v | sed 's/^v//')

  local major
  major=$(echo "$node_version" | cut -d. -f1)

  # 版本要求: ^20.19.0 || >=22.12.0
  if [ "$major" -ge 22 ] && version_gte "$node_version" "22.12.0"; then
    log_success "Node.js v${node_version} ✓"
    return
  elif [ "$major" -eq 20 ] && version_gte "$node_version" "20.19.0"; then
    log_success "Node.js v${node_version} ✓"
    return
  fi

  log_error "Node.js 版本不满足要求: v${node_version}"
  echo "  需要 ^20.19.0 或 >=22.12.0"
  echo "  建议运行: nvm install 22"
  exit 1
}

# ---- 检查并安装 pnpm ----
check_pnpm() {
  if command_exists pnpm; then
    local pnpm_version
    pnpm_version=$(pnpm -v 2>/dev/null)
    log_success "pnpm v${pnpm_version} ✓"
    return
  fi

  log_warn "未检测到 pnpm，正在安装..."

  if command_exists corepack; then
    log_info "通过 corepack 安装 pnpm..."
    corepack enable 2>/dev/null || true
    corepack prepare pnpm@latest --activate 2>/dev/null || {
      log_warn "corepack 安装失败，尝试 npm 安装..."
      npm install -g pnpm
    }
  else
    log_info "通过 npm 安装 pnpm..."
    npm install -g pnpm
  fi

  if command_exists pnpm; then
    local pnpm_version
    pnpm_version=$(pnpm -v 2>/dev/null)
    log_success "pnpm v${pnpm_version} 安装成功 ✓"
  else
    log_error "pnpm 安装失败"
    echo "  请手动安装: npm install -g pnpm"
    exit 1
  fi
}

# ---- 主流程 ----
main() {
  local os
  os=$(detect_os)

  if [ "$os" = "windows" ]; then
    log_error "当前环境为 Windows (MINGW/MSYS/CYGWIN)"
    echo ""
    echo "  推荐使用以下方式之一："
    echo ""
    echo "  1. 使用 PowerShell 版本:"
    echo -e "     ${CYAN}irm https://zhin.js.org/install.ps1 | iex${NC}"
    echo ""
    echo "  2. 在 WSL 中运行本脚本:"
    echo -e "     ${CYAN}wsl curl -fsSL https://zhin.js.org/install.sh | bash${NC}"
    echo ""
    echo "  3. 直接使用 pnpm:"
    echo -e "     ${CYAN}pnpm create zhin-app${NC}"
    echo ""
    exit 1
  fi

  if [ "$os" = "unknown" ]; then
    log_warn "未识别的操作系统: $(uname -s)，将尝试继续..."
  fi

  print_banner

  log_info "正在检查环境... ($(uname -s) $(uname -m))"
  echo ""

  check_node
  check_pnpm

  echo ""
  log_info "正在启动 Zhin.js 脚手架..."
  echo ""

  # 当通过 curl | bash 执行时，stdin 被管道占用，
  # 需要重定向到 /dev/tty 以支持交互式 prompt
  if [ ! -t 0 ] && [ -e /dev/tty ]; then
    pnpm create zhin-app "$@" </dev/tty
  else
    pnpm create zhin-app "$@"
  fi
}

main "$@"
