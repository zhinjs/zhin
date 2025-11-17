
# Zhin.js

🚀 现代 TypeScript 机器人框架，专注于插件化、热重载和多平台生态

[![文档](https://img.shields.io/badge/文档-zhin.pages.dev-blue)](https://zhin.pages.dev)
[![CI](https://github.com/zhinjs/zhin/actions/workflows/ci.yml/badge.svg)](https://github.com/zhinjs/zhin/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/codecov/c/github/zhinjs/zhin)](https://codecov.io/gh/zhinjs/zhin)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

## 🌟 核心特性

- 🎯 **TypeScript 全量类型支持** - 完整类型推导，极致开发体验
- ⚡ **热重载系统** - 代码/配置/插件变更自动生效，无需重启
- 🧩 **插件化架构** - 热插拔插件系统，灵活扩展
- 🎨 **Schema 配置系统** - 类型安全的配置管理，支持可视化编辑
- 🌐 **Web 控制台** - 实时监控、插件管理、配置编辑
- 🛠️ **命令行工具链** - 一键创建/开发/调试/部署
- 📦 **开箱即用** - 内置控制台适配器、HTTP服务、Web控制台、SQLite数据库
- 🔌 **多平台扩展** - 支持 QQ、KOOK、Discord、Telegram、OneBot v11 等

## 项目结构

## 项目结构

```
zhin/
├── basic/                  # 基础层 - 底层工具和类型
│   ├── types/             # TypeScript 类型定义
│   ├── logger/            # 日志系统
│   ├── database/          # 数据库抽象层
│   ├── schema/            # Schema 系统
│   ├── dependency/        # 依赖管理
│   ├── cli/               # 命令行工具
│   └── hmr/               # 热模块替换
│
├── packages/               # 核心层 - 框架核心
│   ├── core/              # 核心框架
│   ├── client/            # 客户端库
│   ├── create-zhin/       # 项目脚手架
│   └── zhin/              # 主入口包
│
├── plugins/                # 插件层 - 扩展生态
│   ├── services/          # 功能服务插件
│   │   ├── console/      # Web 控制台
│   │   └── http/         # HTTP 服务
│   │
│   ├── adapters/          # 平台适配器
│   │   ├── icqq/         # QQ 适配器 (基于 ICQQ)
│   │   ├── kook/         # KOOK 适配器
│   │   ├── onebot11/     # OneBot v11 协议适配器
│   │   ├── discord/      # Discord 适配器
│   │   ├── process/      # 进程管理适配器
│   │   └── ...
│   │
│   ├── games/             # 游戏娱乐插件
│   └── utils/             # 工具类插件
│
└── examples/               # 示例项目
    ├── test-bot/          # 示例机器人
    └── dependency/        # 依赖系统示例
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
# 使用 create-zhin 创建项目（会自动安装 pnpm 和依赖）
npm create zhin-app my-bot
# 或
pnpm create zhin-app my-bot

# 交互式配置流程：
# 1. 选择运行时（Node.js / Bun）
# 2. 选择配置格式（TypeScript / JavaScript / YAML / JSON）
# 3. 配置 Web 控制台登录信息（用户名/密码）

cd my-bot

# 开发模式启动（支持热重载）
pnpm dev

# 访问 Web 控制台：http://localhost:8086
# 登录信息已保存在 .env 文件中

# 创建新插件
zhin new my-plugin

# 构建插件
pnpm build
```


## 💡 主要用法示例

### 基础使用

```typescript
import { createApp, addCommand, MessageCommand, Schema, defineSchema } from 'zhin.js'

// 创建应用
const app = await createApp({
  bots: [{ name: 'console', context: 'process' }],
  plugins: ['http', 'console', 'adapter-process']
})

// 定义插件配置 Schema
defineSchema(Schema.object({
  greeting: Schema.string()
    .default('Hello')
    .description('问候语'),
  maxRetries: Schema.number()
    .default(3)
    .min(1).max(10)
    .description('最大重试次数')
}))

// 添加命令
addCommand(new MessageCommand('hello <name>')
  .action(async (message, result) => {
    const config = usePlugin().config
    return `${config.greeting}, ${result.args.name}!`
  })
)

await app.start()
```

### 高级功能 - 依赖注入

```typescript
import { register, useContext } from 'zhin.js'

// 注册服务
register({
  name: 'cache',
  async mounted() {
    return new RedisCache()
  },
  async dispose(cache) {
    await cache.disconnect()
  }
})

// 使用依赖
useContext('database', 'cache', (db, cache) => {
  addCommand(new MessageCommand('user <id>')
    .action(async (message, result) => {
      // 先查缓存
      let user = await cache.get(`user:${result.args.id}`)
      if (!user) {
        // 缓存未命中，查数据库
        user = await db.model('users').findByPk(result.args.id)
        await cache.set(`user:${result.args.id}`, user, 300)
      }
      return `用户信息: ${user.name}`
    })
  )
})
```


## 常用命令

### 项目级命令（在项目根目录执行）

```bash
pnpm dev              # 启动开发服务器（热重载）
pnpm start            # 启动生产环境
pnpm daemon           # 后台运行
pnpm stop             # 停止机器人
pnpm build            # 构建所有插件（不是 app）
```

### CLI 工具命令（全局可用）

```bash
zhin dev              # 启动开发模式（等同于 pnpm dev）
zhin start            # 启动生产环境
zhin stop             # 停止机器人
zhin new <plugin>     # 创建新插件（自动添加到依赖）
zhin build [plugin]   # 构建插件（不指定则构建所有）
zhin build --clean    # 清理后构建
```

### 开发工作流

```bash
# 1. 创建项目
npm create zhin-app my-bot

# 2. 启动开发
cd my-bot
pnpm dev

# 3. 创建插件
zhin new my-plugin

# 4. 开发插件（修改 plugins/my-plugin/app/index.ts）
# 文件保存后自动重载 ⚡

# 5. 构建插件
pnpm build
# 或只构建特定插件
zhin build my-plugin

# 6. 在配置文件中启用插件
# 编辑 zhin.config.ts，添加 'my-plugin' 到 plugins 数组
```


## 🌐 Web 控制台

启动后访问 `http://localhost:8086` 查看 Web 管理界面：

**登录信息：**
- 使用 `create-zhin-app` 创建项目时配置
- 保存在项目的 `.env` 文件中
- 可随时修改 `.env` 文件更新密码

> 💡 **安全提示**: `.env` 文件已自动添加到 `.gitignore`，不会被提交到版本控制

**功能特性：**
- 📊 **实时监控** - 机器人状态、消息统计、性能指标
- 🧩 **插件管理** - 启用/禁用插件、查看插件信息
- ⚙️ **配置编辑** - 可视化配置编辑，支持 Schema 验证
- 📝 **日志查看** - 实时日志流、过滤和搜索
- 🗄️ **数据库管理** - 数据表查看、SQL 查询
- 🔄 **热重载监控** - 文件变更监控、重载状态


## ⚙️ 配置系统

### 配置文件

支持 TypeScript/JS/JSON/YAML 格式，推荐使用 `zhin.config.ts`：

```typescript
import { defineConfig, LogLevel } from 'zhin.js'

export default defineConfig({
  // 基础配置
  log_level: LogLevel.INFO,
  debug: false,
  
  // 机器人实例
  bots: [
    { name: 'console', context: 'process' }
  ],
  
  // 插件配置
  plugins: [
    'http',              // HTTP 服务
    'console',           // Web 控制台
    'adapter-process',   // 控制台适配器
    // 'adapter-icqq',   // QQ 适配器（需额外安装）
  ],
  
  // 插件目录
  plugin_dirs: [
    './src/plugins',           // 项目自定义插件
    'node_modules',            // 第三方插件
    'node_modules/@zhin.js'    // 官方插件
  ],
  
  // HTTP 服务配置
  http: {
    port: 8086,                // 服务端口
    username: 'admin',         // 控制台用户名
    password: '123456',        // 控制台密码
    base: '/api'               // API 基础路径
  },
  
  // 数据库配置
  database: {
    dialect: 'sqlite',
    filename: './data/bot.db'
  }
})
```

### Schema 配置系统

插件可以定义配置 Schema，支持类型验证和 Web 界面编辑：

```typescript
import { Schema, defineSchema } from 'zhin.js'

// 定义插件配置结构
defineSchema(Schema.object({
  apiKey: Schema.string()
    .required()
    .description('API 密钥'),
  
  timeout: Schema.number()
    .default(5000)
    .min(1000)
    .description('请求超时时间（毫秒）'),
  
  features: Schema.union([
    Schema.string(),
    Schema.list(Schema.string())
  ]).description('启用的功能'),
  
  advanced: Schema.object({
    retries: Schema.number().default(3),
    cache: Schema.boolean().default(true)
  }).description('高级设置')
}))
```


## ⚡ 热重载体验

Zhin.js 提供了业界领先的热重载系统：

### 📂 文件变更自动检测
- 插件代码修改 → 自动重载插件
- 配置文件变更 → 自动应用配置
- 依赖关系更新 → 智能重新注入

### 🔄 零停机更新
- 保持机器人连接不中断
- 依赖服务平滑切换
- 状态数据自动迁移

### 🛡️ 错误恢复机制
- 语法错误自动回滚
- 依赖冲突智能处理
- 详细错误日志提示

```bash
# 开发模式启动热重载
pnpm dev

# 修改插件文件，立即生效 ⚡
# 更新配置文件，自动应用 🔄
# 添加新插件，自动加载 🚀
```


## 🌍 生态系统与扩展

### 📦 开箱即用
| 包名 | 功能 | 状态 |
|------|------|------|
| `@zhin.js/adapter-process` | 控制台适配器 | ✅ 内置 |
| `@zhin.js/http` | HTTP 服务器 | ✅ 内置 |
| `@zhin.js/console` | Web 控制台 | ✅ 内置 |
| SQLite 数据库 | 本地数据存储 | ✅ 内置 |

### 🔌 平台适配器
| 平台 | 包名 | 状态 |
|------|------|------|
| QQ | `@zhin.js/adapter-icqq` | ✅ 可用 |
| KOOK | `@zhin.js/adapter-kook` | ✅ 可用 |
| Discord | `@zhin.js/adapter-discord` | ✅ 可用 |
| Telegram | `@zhin.js/adapter-telegram` | 🚧 开发中 |
| OneBot v11 | `@zhin.js/adapter-onebot11` | ✅ 可用 |
| 微信公众号 | `@zhin.js/adapter-wechat-mp` | ✅ 可用 |

### 🗄️ 数据库扩展
| 数据库 | 包名 | 状态 |
|-------|------|------|
| MySQL | `@zhin.js/database-mysql` | 🚧 开发中 |
| PostgreSQL | `@zhin.js/database-pg` | 🚧 开发中 |
| MongoDB | `@zhin.js/database-mongo` | 📋 计划中 |

### 🛠️ 开发工具
| 工具 | 包名 | 功能 |
|------|------|------|
| CLI 工具 | `@zhin.js/cli` | 项目管理、构建部署 |
| 项目脚手架 | `create-zhin-app` | 快速创建项目 |
| VS Code 扩展 | `zhin-vscode` | 语法高亮、调试支持 |


## 开发要求
- Node.js 20.19.0+ 或 22.12.0+
- pnpm 9.0+


## ⚠️ 生产环境注意事项

**重要**：在生产环境部署时，请注意以下配置以避免服务器卡死：

```typescript
// ❌ 错误配置（会导致监听大量文件）
plugin_dirs: ['node_modules', 'node_modules/@zhin.js']

// ✅ 正确配置（仅监听必要的目录）
plugin_dirs: ['./plugins']
```

详细部署指南请参考 [生产环境部署文档](./docs/guide/production-deployment.md)。

## 📚 更多文档
- [完整文档](./docs/)
- [生产环境部署](./docs/guide/production-deployment.md)
- [最佳实践](./docs/guide/best-practices.md)
- [架构设计](./docs/guide/architecture.md)

## 许可证
MIT License
