# @zhin.js/core

Zhin.js 核心框架包，提供插件系统、Feature 架构、AI 智能体、消息路由等全部核心能力。

## 核心概念

### Plugin（插件）

插件是 Zhin.js 的基本组织单位。每个插件拥有独立的生命周期和上下文，通过 `usePlugin()` Hook 访问框架能力。

```typescript
import { usePlugin, MessageCommand } from '@zhin.js/core'

const { addCommand, addTool, addCron, onMounted, onDispose } = usePlugin()

onMounted(() => console.log('插件已挂载'))
onDispose(() => console.log('插件已卸载'))

addCommand(
  new MessageCommand('hello <name:string>')
    .desc('打招呼')
    .action((_, result) => `Hello, ${result.params.name}!`)
)
```

### Feature（特性抽象）

Feature 是 Zhin.js 的核心扩展机制。所有内置功能均继承自 `Feature` 抽象基类，提供统一的注册/注销、插件归属追踪和 JSON 序列化能力。

```
Feature (抽象基类)
├── CommandFeature    — 消息命令       addCommand()
├── ToolFeature       — AI 可调用工具   addTool()
├── SkillFeature      — 技能聚合       declareSkill()
├── CronFeature       — 定时任务       addCron()
├── DatabaseFeature   — 数据模型       defineModel()
├── ComponentFeature  — 消息组件       addComponent()
├── ConfigFeature     — 插件配置       addConfig()
└── PermissionFeature — 权限管理
```

每个 Feature 都会在 `Plugin.prototype` 上注入对应的扩展方法（如 `addCommand`、`addTool`），插件通过 `usePlugin()` 获取这些方法。

### Adapter（适配器）

适配器将不同聊天平台接入 Zhin.js，统一消息收发接口。

```typescript
// 适配器通过 Adapter.register 静态注册
Adapter.register('my-platform', MyAdapter)
```

每个适配器可以通过 `addTool()` 注册平台工具，通过 `declareSkill()` 将工具聚合为 AI 可理解的技能。

### MessageDispatcher（消息路由）

三阶段消息处理管线：

```
消息到达 → Guardrail（守卫） → Route（路由） → Handle（处理）
                │                    │                │
           权限/频率检查         命令 or AI？      执行命令 / AI Agent
```

- **Guardrail** — 鉴权、速率限制、黑名单等前置检查
- **Route** — 判断消息是命令还是 AI 对话
- **Handle** — CommandFeature 处理命令，ZhinAgent 处理 AI 对话

### AI 模块（ZhinAgent）

内置 AI 智能体，支持 OpenAI / Ollama 等大模型。

```
用户消息 → 速率限制 → 工具过滤 → 会话记忆 → LLM 调用 → 输出
                                    │
                              三条路径选择：
                         闲聊（0工具）→ 1次 LLM
                         快速（无参数工具）→ 预执行 + 1次 LLM
                         Agent（有参数工具）→ 多轮 tool-calling
```

核心子模块：

| 模块 | 说明 |
|------|------|
| `SessionManager` | 会话管理（内存/数据库） |
| `ContextManager` | 上下文构建与滑动窗口 |
| `ConversationMemory` | 话题感知、链式摘要 |
| `UserProfileStore` | 用户画像 |
| `RateLimiter` | 频率限制 |
| `FollowUpManager` | 定时提醒（持久化） |
| `ToneDetector` | 情绪分析 |
| `OutputParser` | 多模态输出解析 |

## 主要导出

```typescript
// 插件系统
export { Plugin, usePlugin, getPlugin } from './plugin.js'

// Feature 体系
export { Feature } from './feature.js'
export { CommandFeature } from './built/command.js'
export { ToolFeature, ZhinTool } from './built/tool.js'
export { SkillFeature } from './built/skill.js'
export { CronFeature } from './built/cron.js'
export { DatabaseFeature } from './built/database.js'
export { ComponentFeature } from './built/component.js'
export { ConfigFeature } from './built/config.js'
export { PermissionFeature } from './built/permission.js'

// 消息路由
export { createMessageDispatcher } from './built/dispatcher.js'

// AI
export { ZhinAgent } from './ai/index.js'

// 适配器
export { Adapter } from './adapter.js'

// 工具
export { MessageCommand } from './command.js'
export { Message } from './message.js'
export { Cron } from './cron.js'
export { Schema } from '@zhin.js/schema'
```

## 安装

```bash
pnpm add @zhin.js/core
```

> 通常不需要直接安装此包。使用 `zhin.js` 主入口包即可自动引入。

## 许可证

MIT License
