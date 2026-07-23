#!/usr/bin/env bash
# ============================================================================
# Zhin Monorepo → Monorepo + Submodule 迁移脚本
# ============================================================================
#
# 将当前单一 monorepo 拆分为：
#   1. zhin          (主仓) - basic/, packages/, scripts/, examples/
#   2. plugins  (子仓) - plugins/** (adapters, services, features, utils, games)
#   3. docs     (子仓) - docs/
#
# 前置条件：
#   1. GitHub 仓库：
#      - https://github.com/zhinjs/plugins (已有仓库，将 force push 重置)
#      - https://github.com/zhinjs/docs    (空白仓库)
#   2. 安装 git-filter-repo: brew install git-filter-repo
#   3. 确保当前仓库无未提交更改
#
# 用法：
#   chmod +x scripts/migrate-to-submodules.sh
#   ./scripts/migrate-to-submodules.sh
#
# 注意：此脚本需要人工审核后分步执行，不会自动 push。
# ============================================================================

set -euo pipefail

MAIN_REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORK_DIR="$(mktemp -d)"
GITHUB_ORG="zhinjs"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ============================================================================
# 第一步：检查环境
# ============================================================================
step1_check() {
    info "=== 第一步：环境检查 ==="
    
    if ! command -v git-filter-repo &>/dev/null; then
        error "需要安装 git-filter-repo"
        echo "  macOS:  brew install git-filter-repo"
        echo "  其他:   pip install git-filter-repo"
        exit 1
    fi
    
    cd "$MAIN_REPO_DIR"
    if ! git diff --quiet || ! git diff --cached --quiet; then
        error "当前仓库有未提交更改，请先 commit 或 stash"
        exit 1
    fi
    
    info "环境检查通过 ✓"
    info "工作目录: $WORK_DIR"
}

# ============================================================================
# 第二步：提取 plugins/ 子树（保留 git 历史）
# ============================================================================
step2_extract_plugins() {
    info "=== 第二步：提取 plugins/ 子仓库 ==="
    
    # 克隆一份完整仓库用于提取
    info "克隆仓库到临时目录..."
    git clone --no-local "$MAIN_REPO_DIR" "$WORK_DIR/plugins"
    cd "$WORK_DIR/plugins"
    
    # 用 git-filter-repo 只保留 plugins/ 目录，并将其移到根目录
    info "提取 plugins/ 历史..."
    git-filter-repo \
        --subdirectory-filter plugins/ \
        --force
    
    # 添加子仓库自己的配置文件（由后续步骤创建）
    info "plugins 子仓库已提取到: $WORK_DIR/plugins"
    echo "  文件数: $(find . -type f -not -path './.git/*' | wc -l | tr -d ' ')"
}

# ============================================================================
# 第三步：提取 docs/ 子树
# ============================================================================
step3_extract_docs() {
    info "=== 第三步：提取 docs/ 子仓库 ==="
    
    git clone --no-local "$MAIN_REPO_DIR" "$WORK_DIR/docs"
    cd "$WORK_DIR/docs"
    
    info "提取 docs/ 历史..."
    git-filter-repo \
        --subdirectory-filter docs/ \
        --force
    
    info "docs 子仓库已提取到: $WORK_DIR/docs"
    echo "  文件数: $(find . -type f -not -path './.git/*' | wc -l | tr -d ' ')"
}

# ============================================================================
# 第四步：为子仓库添加配置文件
# ============================================================================
step4_setup_subrepo_configs() {
    info "=== 第四步：设置子仓库配置 ==="
    
    # --- plugins 配置 ---
    cd "$WORK_DIR/plugins"
    
    # package.json
    cat > package.json << 'PLUGINS_PKG'
{
  "name": "@zhinjs/plugins",
  "version": "1.0.0",
  "description": "Zhin.js 插件生态仓库",
  "private": true,
  "type": "module",
  "engines": {
    "node": "^20.19.0 || >=22.12.0"
  },
  "packageManager": "pnpm@9.0.2",
  "scripts": {
    "build": "pnpm -r build",
    "clean": "pnpm -r clean",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint . --ext .ts,.tsx",
    "release": "pnpm changeset",
    "bump": "pnpm changeset version",
    "pub": "pnpm changeset publish"
  },
  "devDependencies": {
    "@changesets/cli": "^2.29.7",
    "@types/node": "^24.10.0",
    "typescript": "^5.8.3",
    "vitest": "^2.1.9",
    "rimraf": "^6.1.2"
  }
}
PLUGINS_PKG

    # pnpm-workspace.yaml
    cat > pnpm-workspace.yaml << 'PLUGINS_WS'
packages:
  - 'adapters/*'
  - 'services/*'
  - 'features/*'
  - 'utils/*'
  - 'games/*'
PLUGINS_WS

    # tsconfig.json
    cat > tsconfig.json << 'PLUGINS_TS'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": false,
    "noEmit": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": false,
    "allowSyntheticDefaultImports": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "jsx": "react-jsx",
    "jsxImportSource": "zhin.js",
    "types": []
  },
  "include": [
    "adapters/**/*",
    "services/**/*",
    "features/**/*",
    "utils/**/*",
    "games/**/*"
  ],
  "exclude": [
    "node_modules",
    "lib",
    "dist",
    "**/client/**",
    "**/*.js"
  ]
}
PLUGINS_TS

    # .changeset/config.json
    mkdir -p .changeset
    cat > .changeset/config.json << 'PLUGINS_CS'
{
  "$schema": "https://unpkg.com/@changesets/config@3.1.1/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
PLUGINS_CS

    # README.md
    cat > README.md << 'PLUGINS_README'
# Zhin.js Plugins

Zhin.js 插件生态仓库，包含适配器、服务、工具等插件。

## 独立开发

```bash
pnpm install
pnpm build
pnpm test
```

## 作为 submodule 使用

此仓库通常作为 [zhin](https://github.com/zhinjs/zhin) 主仓库的 submodule 使用：

```bash
git clone --recurse-submodules https://github.com/zhinjs/zhin.git
```

## 目录结构

- `adapters/` - 平台适配器 (icqq, kook, discord, qq, onebot11, ...)
- `services/` - 功能服务 (http, console, mcp)
- `features/` - 特性插件
- `utils/` - 工具插件 (music, sensitive-filter, ...)
- `games/` - 游戏插件
PLUGINS_README

    git add -A
    git commit -m "chore: add sub-repo configuration files" || true
    
    info "plugins 配置完成 ✓"
    
    # --- docs 无需额外配置（已有 package.json）---
    info "docs 已有 package.json，无需额外修改 ✓"
}

# ============================================================================
# 第五步：替换 plugins 中的 workspace: 引用
# ============================================================================
step5_replace_workspace_refs() {
    info "=== 第五步：替换 workspace: 引用为版本范围 ==="
    
    cd "$WORK_DIR/plugins"
    
    # 收集版本映射到临时文件（兼容 bash 3.x，macOS 默认）
    VERSION_MAP="$WORK_DIR/.pkg-versions"
    : > "$VERSION_MAP"
    
    for pkg_json in "$MAIN_REPO_DIR"/packages/*/package.json "$MAIN_REPO_DIR"/basic/*/package.json "$MAIN_REPO_DIR"/plugins/*/package.json "$MAIN_REPO_DIR"/plugins/*/*/package.json; do
        [ -f "$pkg_json" ] || continue
        name=$(grep -o '"name": "[^"]*"' "$pkg_json" | head -1 | sed 's/"name": "\(.*\)"/\1/')
        version=$(grep -o '"version": "[^"]*"' "$pkg_json" | head -1 | sed 's/"version": "\(.*\)"/\1/')
        if [ -n "$name" ] && [ -n "$version" ]; then
            echo "$name=$version" >> "$VERSION_MAP"
        fi
    done
    
    info "检测到的包版本:"
    while IFS='=' read -r pkg ver; do
        echo "  $pkg: $ver"
    done < "$VERSION_MAP"
    
    # 替换所有 plugin package.json 中的 workspace:* 引用
    find . -name package.json -not -path '*/node_modules/*' -not -path './package.json' | while read -r pkg_file; do
        if grep -q "workspace:" "$pkg_file"; then
            info "处理: $pkg_file"
            while IFS='=' read -r dep_name dep_version; do
                sed -i.bak "s|\"$dep_name\": \"workspace:\\*\"|\"$dep_name\": \"^$dep_version\"|g" "$pkg_file"
            done < "$VERSION_MAP"
            rm -f "${pkg_file}.bak"
        fi
    done
    
    # 验证没有残留的 workspace: 引用
    remaining=$(find . -name package.json -not -path '*/node_modules/*' -exec grep -l "workspace:" {} \; 2>/dev/null || true)
    if [ -n "$remaining" ]; then
        warn "仍有残留 workspace: 引用:"
        echo "$remaining"
    else
        info "所有 workspace: 引用已替换 ✓"
    fi
    
    git add -A
    git commit -m "chore: replace workspace:* with version ranges for standalone use" || true
}

# ============================================================================
# 第六步：输出后续手动操作指南
# ============================================================================
step6_instructions() {
    info "=== 提取完成！后续手动操作 ==="
    
    cat << INSTRUCTIONS

${GREEN}════════════════════════════════════════════════════════════${NC}
${GREEN}  子仓库已提取到: $WORK_DIR${NC}
${GREEN}════════════════════════════════════════════════════════════${NC}

${YELLOW}请按以下步骤手动完成迁移：${NC}

${GREEN}1. 准备 GitHub 仓库：${NC}
   - https://github.com/${GITHUB_ORG}/plugins ${YELLOW}(已有仓库，需要重置)${NC}
   - https://github.com/${GITHUB_ORG}/docs    ${GREEN}(空白仓库)${NC}

${GREEN}2. 推送子仓库到 GitHub：${NC}
   ${YELLOW}# plugins 仓库已有内容，需要 force push 重置${NC}
   cd $WORK_DIR/plugins
   git remote add origin https://github.com/${GITHUB_ORG}/plugins.git
   git push -u origin main --force

   cd $WORK_DIR/docs
   git remote add origin https://github.com/${GITHUB_ORG}/docs.git
   git push -u origin main

${GREEN}3. 在主仓库中，删除旧目录并添加 submodule：${NC}
   cd $MAIN_REPO_DIR
   
   # 删除旧目录（git rm 保留历史）
   git rm -rf plugins/
   git rm -rf docs/
   git commit -m "chore: remove plugins/ and docs/ for submodule migration"
   
   # 添加 submodule
   git submodule add https://github.com/${GITHUB_ORG}/plugins.git plugins
   git submodule add https://github.com/${GITHUB_ORG}/docs.git docs
   git commit -m "chore: add plugins and docs as submodules"

${GREEN}4. 复制更新的配置文件到主仓库：${NC}
   已自动生成在主仓库的 scripts/submodule-configs/ 目录下，
   请将对应文件复制覆盖即可。

${GREEN}5. 推送主仓库：${NC}
   cd $MAIN_REPO_DIR
   git push origin main

${GREEN}6. 验证：${NC}
   # 全新克隆测试
   cd /tmp
   git clone --recurse-submodules https://github.com/${GITHUB_ORG}/zhin.git test-zhin
   cd test-zhin
   pnpm install
   pnpm build

${YELLOW}日常使用提示：${NC}
   # 克隆（含 submodule）
   git clone --recurse-submodules https://github.com/${GITHUB_ORG}/zhin.git
   
   # 已有仓库初始化 submodule
   git submodule update --init --recursive
   
   # 更新 submodule 到最新
   git submodule update --remote plugins
   git submodule update --remote docs

INSTRUCTIONS
}

# ============================================================================
# 主流程
# ============================================================================
main() {
    echo ""
    info "╔══════════════════════════════════════════════════╗"
    info "║  Zhin Monorepo → Submodule 迁移工具             ║"
    info "╚══════════════════════════════════════════════════╝"
    echo ""
    
    step1_check
    step2_extract_plugins
    step3_extract_docs
    step4_setup_subrepo_configs
    step5_replace_workspace_refs
    step6_instructions
    
    info "迁移准备工作完成！"
    info "临时文件位于: $WORK_DIR"
    warn "请仔细审核后执行手动步骤"
}

main "$@"
