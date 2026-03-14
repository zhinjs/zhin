#!/bin/sh
set -e

# Zhin.js Docker 入口脚本

show_help() {
    echo ""
    echo "🤖 Zhin.js Docker 使用指南"
    echo ""
    echo "用法: docker run [options] ghcr.io/zhinjs/zhin <command> [args]"
    echo ""
    echo "命令:"
    echo "  create <name>     创建新的 Zhin 项目"
    echo "  create -y <name>  使用默认配置快速创建项目"
    echo "  dev               开发模式运行（需挂载项目目录）"
    echo "  start             生产模式运行（需挂载项目目录）"
    echo "  install           安装项目依赖"
    echo "  build             构建项目"
    echo "  shell             进入交互式 shell"
    echo "  help              显示此帮助信息"
    echo ""
    echo "示例:"
    echo ""
    echo "  # 创建新项目（交互式）"
    echo "  docker run -it -v \$(pwd):/workspace -w /workspace ghcr.io/zhinjs/zhin create my-bot"
    echo ""
    echo "  # 快速创建项目（使用默认配置）"
    echo "  docker run -v \$(pwd):/workspace -w /workspace ghcr.io/zhinjs/zhin create -y my-bot"
    echo ""
    echo "  # 运行已有项目"
    echo "  docker run -v \$(pwd)/my-bot:/app -p 8086:8086 ghcr.io/zhinjs/zhin start"
    echo ""
    echo "  # 开发模式运行"
    echo "  docker run -it -v \$(pwd)/my-bot:/app -p 8086:8086 ghcr.io/zhinjs/zhin dev"
    echo ""
    echo "详细文档: https://zhin.js.org"
    echo ""
}

case "$1" in
    create)
        shift
        # 创建项目使用 create-zhin
        exec create-zhin "$@"
        ;;
    dev)
        shift
        # 开发模式
        if [ ! -f "package.json" ]; then
            echo "❌ 错误: 当前目录不是有效的 Zhin 项目"
            echo "请先创建项目或挂载正确的项目目录"
            exit 1
        fi
        # 检查是否已安装依赖
        if [ ! -d "node_modules" ]; then
            echo "📦 正在安装依赖..."
            pnpm install
        fi
        exec zhin dev "$@"
        ;;
    start)
        shift
        # 生产模式
        if [ ! -f "package.json" ]; then
            echo "❌ 错误: 当前目录不是有效的 Zhin 项目"
            echo "请先创建项目或挂载正确的项目目录"
            exit 1
        fi
        # 检查是否已安装依赖
        if [ ! -d "node_modules" ]; then
            echo "📦 正在安装依赖..."
            pnpm install --frozen-lockfile
        fi
        exec zhin start "$@"
        ;;
    install)
        shift
        # 安装依赖
        exec pnpm install "$@"
        ;;
    build)
        shift
        # 构建项目
        exec pnpm build "$@"
        ;;
    shell|sh|bash)
        # 进入交互式 shell
        exec /bin/sh
        ;;
    help|--help|-h)
        show_help
        ;;
    "")
        show_help
        ;;
    *)
        # 其他命令直接执行
        exec "$@"
        ;;
esac
