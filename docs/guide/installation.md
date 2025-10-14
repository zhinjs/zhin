# 安装和配置

本指南将带你完成 Zhin.js 的安装和基本配置。

## 环境要求

在开始之前，请确保你的环境满足以下要求：

- **Node.js** >= 18.0.0 （推荐使用 LTS 版本）
- **包管理器**：pnpm >= 8.0.0（推荐）、npm 或 yarn
- **操作系统**：Windows 10+、macOS 10.15+、Linux

### 检查环境

```bash
# 检查 Node.js 版本
node --version  # 应该 >= 18.0.0

# 安装 pnpm（推荐）
npm install -g pnpm

# 检查 pnpm 版本
pnpm --version
```

## 创建项目

使用官方脚手架创建新项目：

```bash
# 使用 npm
npm create zhin-app my-bot

# 使用 pnpm（推荐）
pnpm create zhin-app my-bot

# 使用 yarn
yarn create zhin-app my-bot
```

## 项目结构

创建完成后，项目结构如下：

```
my-bot/
├── src/                    # 源代码目录
│   ├── index.ts           # 入口文件
│   └── plugins/           # 插件目录
│       └── test-plugin.ts # 示例插件
├── data/                  # 数据目录
├── .env.example          # 环境变量示例
├── zhin.config.ts        # 配置文件
├── package.json
└── tsconfig.json
```

### 目录说明

- **src/** - 所有源代码，支持 TypeScript
- **src/plugins/** - 插件目录，每个文件是一个插件
- **data/** - 运行时数据（数据库、日志、缓存等）
- **.env** - 环境变量文件（敏感信息）
- **zhin.config.ts** - 机器人配置文件

## 配置文件

`zhin.config.ts` 是核心配置文件：

```typescript
import { defineConfig } from 'zhin.js'
import path from 'node:path'

export default defineConfig(async (env) => {
  return {
    // 数据库配置
    database: {
      dialect: 'sqlite',
      filename: './data/bot.db'
    },
    
    // 机器人实例
    bots: [
      {
        name: `${process.pid}`,  // 进程ID作为名称
        context: 'process'        // 控制台适配器
      }
    ],
    
    // 插件目录
    plugin_dirs: [
      env.PLUGIN_DIR || './src/plugins',  // 自定义插件
      'node_modules',                      // npm 插件
      path.join('node_modules', '@zhin.js') // 官方插件
    ],
    
    // 启用的插件
    plugins: [
      'http',              // HTTP 服务
      'adapter-process',   // 控制台适配器
      'console',           // Web 控制台
      'test-plugin'        // 你的插件
    ],
    
    // 调试模式
    debug: env.DEBUG === 'true'
  }
})
```

## 环境变量

复制 `.env.example` 为 `.env` 并配置：

```bash
cp .env.example .env
```

`.env` 文件内容：

```bash
# 调试模式
DEBUG=true

# QQ 机器人配置（如需要）
QQ_ACCOUNT=123456789
QQ_PASSWORD=your_password

# KOOK 机器人配置（如需要）
KOOK_TOKEN=your_token

# QQ 官方机器人配置（如需要）
QQ_APPID=102073979
QQ_SECRET=your_secret
```

## 启动项目

### 开发模式

```bash
# 进入项目目录
cd my-bot

# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev
```

启动后你会看到：

```
[INFO] Zhin.js v1.0.0
[INFO] Loading plugins...
[INFO] Plugin loaded: http
[INFO] Plugin loaded: adapter-process
[INFO] Plugin loaded: console
[INFO] Plugin loaded: test-plugin
[INFO] Process 适配器已就绪，可以在控制台输入消息测试
[INFO] Web 控制台: http://localhost:8086
```

### 测试机器人

在控制台输入消息测试：

```bash
> hello
< 你好！欢迎使用 Zhin.js

> zt
< -------概览-------
  操作系统：Darwin 23.6.0 arm64
  内存占用：1.23GB/16.00GB 7.69%
  ...
```

### Web 控制台

打开浏览器访问 `http://localhost:8086`（默认用户名密码：admin/123456）

你将看到：
- 📊 实时状态监控
- 🤖 机器人列表
- 🧩 插件管理
- 📝 日志查看

## 生产部署

### 构建项目

```bash
# 编译 TypeScript
pnpm build
```

### 启动服务

```bash
# 前台启动
pnpm start

# 后台启动（守护进程）
pnpm start --daemon

# 使用 Bun 运行时
pnpm start --bun
```

### 进程管理

```bash
# 重启
pnpm restart

# 停止
pnpm stop
```

## 下一步

- 📖 [你的第一个机器人](/guide/your-first-bot) - 编写第一个插件
- 🎯 [命令系统](/guide/commands) - 学习命令开发
- 💾 [数据库](/guide/database) - 使用数据库存储数据
- 🔌 [适配器系统](/guide/adapters) - 连接到不同平台

