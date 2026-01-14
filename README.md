
# Zhin.js

🚀 现代 TypeScript 机器人框架，专注于插件化、热重载和极致开发体验

[![文档](https://img.shields.io/badge/文档-zhin.js.org-blue)](https://zhin.js.org)
[![CI](https://github.com/zhinjs/zhin/actions/workflows/publish.yml/badge.svg)](https://github.com/zhinjs/zhin/actions/workflows/publish.yml)
[![codecov](https://codecov.io/github/zhinjs/zhin/graph/badge.svg?token=37OE7DHMAI)](https://codecov.io/github/zhinjs/zhin)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

## 🌟 核心特性

- 🎯 **TypeScript 全量类型支持** - 完整类型推导，极致开发体验
- ⚡ **智能热重载系统** - 代码变更、配置更新、依赖注入均自动热更，无需重启
- 🏗️ **三层架构设计** - Dependency -> Plugin -> App，结构清晰，高内聚低耦合
- 🧩 **插件化架构** - 热插拔插件系统，支持本地/模块/云端插件
- 🎨 **Schema 配置系统** - 类型安全的配置管理，支持自动重载插件
- 🌐 **Web 控制台** - 实时监控、插件管理、配置编辑
- 📊 **智能性能监控** - 实时内存分析，避免误报，精准定位性能瓶颈
- 📦 **开箱即用** - 内置控制台适配器、HTTP服务、Web控制台、SQLite数据库
- 🔌 **多平台扩展** - 支持 QQ、KOOK、Discord、Telegram、OneBot v11 等

## 🔄 升级到 2.0

Zhin.js 2.0 是一次重大架构升级，带来更简洁的 API 和更强大的功能。

**主要变更**：
- ✅ 移除 `@zhin.js/hmr` 依赖，使用 Node.js 原生模块系统
- ✅ 简化的插件系统（基于 `AsyncLocalStorage`）
- ✅ 配置文件从 `zhin.config.ts` 改为 `zhin.config.yml`
- ✅ API 变更：`useApp()` → `usePlugin()`，`defineModel()` → `plugin.defineModel()`
- ✅ 增强的数据库功能（事务、迁移、生命周期钩子、多对多关系）
- ✅ 自动资源清理，内存优化

**快速升级**：查看 [CHANGELOG.md](./CHANGELOG.md) 了解详细变更和升级步骤。

## 项目结构

```
zhin/
├── basic/                  # 基础层 - 底层工具和类型
│   ├── types/             # TypeScript 类型定义
│   ├── logger/            # 日志系统
│   ├── database/          # 数据库抽象层
│   ├── schema/            # Schema 系统
│   ├── dependency/        # 依赖管理 (Dependency基类)
│   ├── cli/               # 命令行工具
│   └── hmr/               # 热模块替换 (HMRManager)
│
├── packages/               # 核心层 - 框架核心
│   ├── core/              # 核心框架 (App, Plugin)
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
...
```

## 🎓 渐进式学习路径

**为初学者设计！** 我们提供了从零基础到专家的完整学习路径：

| 学习阶段 | 时间 | 你将学到 | 开始 |
|---------|------|----------|------|
| 🌱 **Level 0** | 15 分钟 | 快速启动、发送消息、体验热重载 | [零基础教程](./docs/tutorials/level0-quickstart.md) |
| 💻 **Level 1** | 2-3 小时 | 命令系统、消息监听、日志使用 | [基础应用](./docs/tutorials/level1-basics.md) |
| 🚀 **Level 2** | 4-6 小时 | 中间件、依赖注入、配置系统 | [进阶功能](./docs/tutorials/level2-advanced.md) |
| 🧠 **Level 3** | 6-8 小时 | 架构设计、热重载原理、性能优化 | [架构深入](./docs/guide/architecture.md) |
| 🏆 **Level 4** | 8+ 小时 | 自定义适配器、复杂插件、生产部署 | [专家进阶](./docs/guide/best-practices.md) |

📖 **[查看完整学习指南](./docs/QUICK_LEARN.md)** - 选择适合你的学习路径

---

## 快速开始

### 对于贡献者（开发框架本身）

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


### 创建新项目（推荐用户使用）

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
    // 获取当前插件实例
    const config = usePlugin().config
    return `${config.greeting}, ${result.params.name}!`
  })
)

await app.start()
```

### 高级功能 - 依赖注入与数据库

```typescript
import { register, useContext, onDatabaseReady } from 'zhin.js'

// 使用依赖 (当数据库就绪时执行)
onDatabaseReady((db) => {
  const User = db.model('users');
  
  addCommand(new MessageCommand('user <id>')
    .action(async (message, result) => {
      // 查询数据库
      const user = await User.findByPk(result.params.id)
      return `用户信息: ${user ? user.name : '未知'}`
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
  
  // 插件具体配置 (修改此处将自动重载对应插件) ⚡
  http: {
    port: 8086,
    base: '/api'
  },
  
  // 数据库配置 (修改此处将自动重启数据库) 🔄
  database: {
    dialect: 'sqlite',
    filename: './data/bot.db'
  }
})
```

## ⚡ 热重载体验

Zhin.js 提供了业界领先的热重载系统：

### 📂 全方位变更检测
- **代码修改** → 自动重载插件文件，重新挂载副作用
- **配置变更** → 自动应用新配置，智能重载受影响的插件
- **数据库变更** → 自动重建连接，无缝恢复

### 🔄 零停机更新
- 保持机器人连接不中断
- 依赖服务平滑切换
- 状态数据自动迁移

### 🛡️ 错误恢复机制
- 语法错误自动回滚
- 依赖冲突智能处理
- 详细错误日志提示

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
| Telegram | `@zhin.js/adapter-telegram` | ✅ 可用 |
| Slack | `@zhin.js/adapter-slack` | ✅ 可用 |
| 钉钉 | `@zhin.js/adapter-dingtalk` | ✅ 可用 |
| 飞书 | `@zhin.js/adapter-lark` | ✅ 可用 |
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

## 📚 文档导航

### 🎓 学习资源
- 🚀 **[快速学习指南](./docs/QUICK_LEARN.md)** - 选择适合你的学习路径
- 📘 **[零基础教程](./docs/tutorials/level0-quickstart.md)** - 15分钟快速上手
- 📙 **[基础应用](./docs/tutorials/level1-basics.md)** - 命令和插件开发
- 📕 **[进阶功能](./docs/tutorials/level2-advanced.md)** - 中间件和服务
- 📗 **[完整学习路径](./docs/guide/learning-path.md)** - 系统化学习指南

### 📖 技术文档
- [架构设计](./docs/guide/architecture.md) - 深入理解框架设计
- [核心创新](./docs/guide/innovations.md) - 技术亮点和创新
- [最佳实践](./docs/guide/best-practices.md) - 生产环境指南
- [API 参考](./docs/api/index.md) - 完整 API 文档

### 💡 实用资源
- [示例集合](./docs/examples/) - 实用代码示例
- [插件开发](./docs/plugin/development.md) - 插件开发指南
- [适配器开发](./docs/adapter/development.md) - 适配器开发指南

## 许可证
MIT License
