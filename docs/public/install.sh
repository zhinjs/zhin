#!/usr/bin/env bash
# Zhin.js 一键安装脚本
# 使用方法:
#   curl -fsSL https://zhin.js.org/install.sh | bash
#   curl -fsSL https://zhin.js.org/install.sh | bash -s -- my-bot
#   curl -fsSL https://zhin.js.org/install.sh | bash -s -- my-bot -y

set -eo pipefail

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

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
  echo -e "${BLUE}  Zhin.js - 现代化 TypeScript 聊天机器人框架${NC}"
  echo -e "${BLUE}  https://github.com/zhinjs/zhin${NC}"
  echo ""
}

log_info() {
  echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
  echo -e "${GREEN}✓${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
  echo -e "${RED}✗${NC} $1"
}

# 检查命令是否存在
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# 版本比较: 返回 0 如果 $1 >= $2
version_gte() {
  [ "$(printf '%s\n' "$1" "$2" | sort -V | head -n1)" = "$2" ]
}

# 检查 Node.js
check_node() {
  if ! command_exists node; then
    log_error "未检测到 Node.js"
    echo ""
    echo "请先安装 Node.js >= 20.19.0 或 >= 22.12.0："
    echo ""
    echo "  方式 1 - 使用 nvm（推荐）:"
    echo -e "    ${CYAN}curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash${NC}"
    echo -e "    ${CYAN}nvm install 22${NC}"
    echo ""
    echo "  方式 2 - 官方安装包:"
    echo -e "    ${CYAN}https://nodejs.org/zh-cn/download${NC}"
    echo ""
    exit 1
  fi

  local node_version
  node_version=$(node -v | sed 's/^v//')
  
  # 检查版本: >= 20.19.0 或 >= 22.12.0
  if version_gte "$node_version" "22.12.0"; then
    log_success "Node.js v${node_version} ✓"
    return
  elif version_gte "$node_version" "20.19.0"; then
    # 检查不是 21.x（因为 21 < 22.12）
    local major
    major=$(echo "$node_version" | cut -d. -f1)
    if [ "$major" -eq 20 ] || [ "$major" -ge 22 ]; then
      log_success "Node.js v${node_version} ✓"
      return
    fi
  fi

  log_error "Node.js 版本过低: v${node_version}"
  echo "  需要 >= 20.19.0 或 >= 22.12.0"
  echo "  建议运行: nvm install 22"
  exit 1
}

# 检查并安装 pnpm
check_pnpm() {
  if command_exists pnpm; then
    local pnpm_version
    pnpm_version=$(pnpm -v 2>/dev/null)
    log_success "pnpm v${pnpm_version} ✓"
    return
  fi

  log_warn "未检测到 pnpm，正在安装..."

  # 优先使用 corepack
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

# 主流程
main() {
  print_banner

  log_info "正在检查环境..."
  echo ""
  
  check_node
  check_pnpm
  
  echo ""
  log_info "正在启动 Zhin.js 脚手架..."
  echo ""

  # 透传所有参数给 create-zhin-app
  pnpm create zhin-app "$@"
}

main "$@"
