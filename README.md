
# Zhin.js

现代 TypeScript 机器人框架，专注于插件化、热重载和多平台生态。

## 核心特性

- **TypeScript 全量类型支持**
- **热重载**：开发时代码/配置/插件变更自动生效
- **插件化架构**：支持热插拔插件，灵活扩展
- **Web 控制台**：浏览器实时监控、插件/数据库/日志管理
- **命令行工具链**：一键创建/开发/调试/部署
- **开箱即用**：内置控制台适配器、HTTP服务、Web控制台、SQLite数据库
- **可选扩展**：支持 Telegram、Discord、QQ、KOOK、OneBot v11、MySQL、PostgreSQL 等（需手动安装）

## 项目结构

## 项目结构

```
zhin-next/
├── adapters/           # 平台适配器
│   ├── icqq/          # QQ 适配器 (基于 ICQQ)
│   ├── kook/          # KOOK 适配器
│   ├── onebot11/      # OneBot v11 协议适配器
│   └── process/       # 控制台适配器
├── packages/          # 核心包
│   ├── cli/          # 命令行工具
│   ├── core/         # 核心功能
│   ├── hmr/          # 热重载系统
│   ├── logger/       # 日志系统
│   ├── types/        # 类型定义
│   └── zhin/         # 主包
├── plugins/           # 插件
│   ├── client/       # Vue 客户端框架
│   ├── console/      # Web 控制台
│   └── http/         # HTTP 服务器
└── test-bot/         # 示例机器人
```


## 快速开始

```bash
# 安装依赖
pnpm install

# 构建所有包
pnpm build

# 启动开发模式（热重载）
pnpm dev

# 或进入 test-bot 目录体验示例机器人
cd test-bot && pnpm dev
```


### 创建新项目

```bash
# 使用 CLI 创建项目
pnpm create zhin my-bot
cd my-bot
pnpm install
pnpm dev
```


## 主要用法示例

```typescript
import { createZhinApp, addCommand, onMessage } from 'zhin.js'

const app = await createZhinApp({
  databases: [{
    name: 'main',
    type: 'sqlite',
    database: './data/bot.db'
  }],
  bots: [{
    name: 'console',
    context: 'process' // 控制台适配器，适合开发/测试
  }]
})

// 添加命令
addCommand({
  name: 'hello',
  description: '打招呼',
  async execute(message) {
    await message.reply('Hello, World!')
  }
})

// 监听消息
onMessage(async (message) => {
  if (message.content === 'ping') {
    await message.reply('pong!')
  }
})

await app.start()
```


## 常用命令

```bash
pnpm dev          # 启动开发服务器（热重载）
pnpm build        # 构建所有包
pnpm test         # 运行测试
pnpm lint         # 代码检查
pnpm start        # 启动生产环境
pnpm daemon       # 后台运行
pnpm stop         # 停止机器人
```


## Web 控制台

启动后访问 `http://localhost:8086` 查看 Web 管理界面，支持：

- 实时查看机器人状态和消息统计
- 插件启用/禁用与管理
- 数据库管理与查看
- 日志实时查看
- 配置热更新


## 配置说明

支持 TypeScript/JS/JSON 格式，推荐使用 `zhin.config.ts`：

```typescript
import { defineConfig } from 'zhin.js'

export default defineConfig({
  bots: [
    { name: 'console', context: 'process' }
  ],
  plugins: [
    'http',
    'console',
    'adapter-process',
    // 其他插件...
  ],
  plugin_dirs: [
    './src/plugins',
    'node_modules'
  ]
})
```


## 热重载体验

- 插件/配置/代码变更自动生效，无需重启
- 保持机器人连接不中断


## 生态系统与扩展

### 开箱即用
- `@zhin.js/adapter-process` - 控制台适配器（默认内置）
- `@zhin.js/http` - HTTP 服务
- `@zhin.js/console` - Web 控制台
- SQLite 数据库（默认）

### 可选扩展（需手动安装）
- `@zhin.js/adapter-telegram` - Telegram 适配器
- `@zhin.js/adapter-discord` - Discord 适配器
- `@zhin.js/adapter-qq` - QQ 适配器
- `@zhin.js/adapter-kook` - KOOK 适配器
- `@zhin.js/adapter-onebot11` - OneBot v11 适配器
- `@zhin.js/database-mysql` - MySQL 驱动
- `@zhin.js/database-pg` - PostgreSQL 驱动


## 开发要求
- Node.js 20.19.0+ 或 22.12.0+
- pnpm 9.0+


## 📚 更多文档
- [完整文档](./docs/)
- [最佳实践](./docs/guide/best-practices.md)
- [架构设计](./docs/guide/architecture.md)

## 许可证
MIT License