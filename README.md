
# Zhin.js

现代 TypeScript 聊天机器人框架 —— AI 驱动、插件化、热重载、多平台

[![文档](https://img.shields.io/badge/文档-zhin.js.org-blue)](https://zhin.js.org)
[![CI](https://github.com/zhinjs/zhin/actions/workflows/publish.yml/badge.svg)](https://github.com/zhinjs/zhin/actions/workflows/publish.yml)
[![codecov](https://codecov.io/github/zhinjs/zhin/graph/badge.svg?token=37OE7DHMAI)](https://codecov.io/github/zhinjs/zhin)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

## 核心特性

- **AI 驱动** — 内置 ZhinAgent 智能体，接入 OpenAI / Ollama 等大模型，支持多轮对话、流式输出、工具调用（Function Calling）
- **Tool / Skill 能力体系** — 插件通过 `addTool` 注册可调用工具，通过 `declareSkill` 将工具聚合为语义化技能，AI 按权限和关键词自动路由
- **Feature 可扩展架构** — CommandFeature、ToolFeature、SkillFeature、CronFeature、DatabaseFeature… 所有能力统一抽象，插件按需组合
- **TypeScript 全量类型** — 完整的类型推导和提示，极致开发体验
- **智能热重载** — 代码、配置、依赖变更自动生效，无需重启，错误自动回滚
- **插件化架构** — 基于 AsyncLocalStorage 的上下文管理，React Hooks 风格的 `usePlugin()` API
- **多平台生态** — 统一 API 接口，支持 QQ、Discord、Telegram、KOOK、Slack、钉钉、飞书等 12 个平台
- **Web 控制台** — 实时监控、插件管理、Feature 统计、日志查看

## 快速开始

### 创建新项目

```bash
npm create zhin-app my-bot
cd my-bot
pnpm dev          # 开发模式（热重载）
```

访问 Web 控制台：`http://localhost:8086`

### 贡献者（开发框架本身）

```bash
pnpm install && pnpm build
pnpm dev
```

## 基础用法

```typescript
import { usePlugin, MessageCommand } from 'zhin.js'

const { addCommand } = usePlugin()

addCommand(
  new MessageCommand('hello <name:string>')
    .desc('打个招呼')
    .action((_, result) => `Hello, ${result.params.name}!`)
)
```

## AI 智能体

Zhin.js 内置 AI 智能体系统（ZhinAgent），让机器人具备大模型对话和工具调用能力。

### 启用 AI

```yaml
# zhin.config.yml
ai:
  enabled: true
  providers:
    - type: openai
      model: gpt-4o
      api_key: ${OPENAI_API_KEY}
```

### 注册工具（Tool）

插件可以注册 AI 可调用的工具：

```typescript
import { usePlugin } from 'zhin.js'

const { addTool } = usePlugin()

addTool({
  name: 'get_weather',
  description: '查询指定城市的天气',
  parameters: {
    city: { type: 'string', description: '城市名称', required: true }
  },
  execute: async ({ city }) => {
    return `${city}：晴，25°C`
  }
})
```

### 声明技能（Skill）

将多个工具聚合为一个语义化技能，提供调用约定：

```typescript
import { usePlugin } from 'zhin.js'

const { addTool, declareSkill } = usePlugin()

// 注册若干工具...
addTool({ name: 'mute_member', /* ... */ })
addTool({ name: 'kick_member', /* ... */ })

// 声明技能
declareSkill({
  description: '群管理能力，包括禁言、踢人等',
  keywords: ['群管理', '禁言', '踢人'],
  tags: ['群管理'],
  conventions: 'user_id 为目标成员 QQ 号，group_id 为群号'
})
```

AI 会根据用户消息自动匹配相关 Skill，筛选可用 Tool，并在权限允许时执行调用。

## Feature 系统

Feature 是 Zhin.js 的核心扩展机制。所有内置功能均基于 Feature 实现，每个 Feature 自动管理注册/注销、插件追踪和 JSON 序列化。

| Feature | 插件扩展方法 | 说明 |
|---------|-------------|------|
| CommandFeature | `addCommand()` | 消息命令 |
| ToolFeature | `addTool()` | AI 可调用工具 |
| SkillFeature | `declareSkill()` | 工具聚合为技能 |
| CronFeature | `addCron()` | 定时任务 |
| DatabaseFeature | `defineModel()` | 数据模型 |
| ComponentFeature | `addComponent()` | 消息组件 |
| ConfigFeature | `addConfig()` | 插件级配置 |
| PermissionFeature | — | 权限管理 |

```typescript
import { usePlugin, MessageCommand, Cron } from 'zhin.js'

const { addCommand, addTool, addCron, defineModel } = usePlugin()

// 一个插件可同时使用多种 Feature
addCommand(new MessageCommand('ping').action(() => 'pong'))
addTool({ name: 'dice', description: '掷骰子', parameters: {}, execute: async () => String(Math.ceil(Math.random() * 6)) })
addCron(new Cron('0 8 * * *', () => console.log('早上好')))
```

## 多平台适配器

| 平台 | 包名 | 说明 |
|------|------|------|
| QQ (ICQQ) | `@zhin.js/adapter-icqq` | QQ 非官方协议，功能最全 |
| QQ 官方 | `@zhin.js/adapter-qq` | QQ 官方机器人 API |
| KOOK | `@zhin.js/adapter-kook` | KOOK（开黑啦）|
| Discord | `@zhin.js/adapter-discord` | Discord |
| Telegram | `@zhin.js/adapter-telegram` | Telegram |
| Slack | `@zhin.js/adapter-slack` | Slack |
| 钉钉 | `@zhin.js/adapter-dingtalk` | 钉钉 |
| 飞书 | `@zhin.js/adapter-lark` | 飞书 / Lark |
| OneBot v11 | `@zhin.js/adapter-onebot11` | OneBot v11 协议 |
| 微信公众号 | `@zhin.js/adapter-wechat-mp` | 微信公众号 |
| Sandbox | `@zhin.js/adapter-sandbox` | 终端测试适配器（内置）|
| Email | `@zhin.js/adapter-email` | 邮件 |

每个适配器都可以通过 `addTool()` + `declareSkill()` 将平台能力暴露给 AI。

## 项目结构

```
zhin/
├── basic/                  # 基础层
│   ├── cli/               # 命令行工具
│   ├── database/          # 数据库抽象层
│   ├── logger/            # 日志系统
│   └── schema/            # Schema 系统
│
├── packages/               # 核心层
│   ├── core/              # 核心框架
│   │   └── src/
│   │       ├── ai/        # AI 模块（ZhinAgent、Provider）
│   │       ├── built/     # 内置 Feature（Command、Tool、Skill、Cron…）
│   │       └── ...
│   ├── client/            # Web 控制台客户端
│   ├── create-zhin/       # 项目脚手架
│   └── zhin/              # 主入口包
│
├── plugins/                # 插件生态
│   ├── services/          # 功能服务（http、console…）
│   ├── adapters/          # 平台适配器
│   └── utils/             # 工具插件
│
├── docs/                   # VitePress 文档站
└── examples/               # 示例项目
```

## 常用命令

```bash
# 开发
pnpm dev                    # 开发模式（热重载）
pnpm start                  # 生产模式
pnpm start -- -d            # 后台守护进程模式
npx zhin stop               # 停止后台进程

# 插件管理
npx zhin new <name>         # 创建插件模板
npx zhin build              # 构建插件（--clean 清理后构建）
npx zhin pub                # 发布插件到 npm

# 搜索与安装
npx zhin search <keyword>   # 搜索 npm 上的 Zhin 插件
npx zhin install <name>     # 安装插件
npx zhin info <name>        # 查看插件信息
```

## 文档导航

- [快速开始](./docs/getting-started/index.md) — 安装、创建项目、第一个插件
- [核心概念](./docs/essentials/index.md) — 插件、命令、中间件、适配器
- [配置文件](./docs/essentials/configuration.md) — zhin.config.yml 详解
- [AI 模块](./docs/advanced/ai.md) — ZhinAgent、Provider、触发条件、会话管理
- [工具与技能](./docs/advanced/tools-skills.md) — Tool 注册、Skill 声明、权限控制
- [Feature 系统](./docs/advanced/features.md) — Feature 抽象、内置 Feature、自定义扩展
- [API 参考](./docs/api/index.md) — 完整 API 文档
- [贡献指南](./docs/contributing.md) — 开发环境、代码规范、PR 流程

## 开发要求

- Node.js 20.19.0+ 或 22.12.0+
- pnpm 9.0+

## 许可证

MIT License
