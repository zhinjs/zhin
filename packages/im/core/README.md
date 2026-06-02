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

插件名称默认从文件路径推导，也可以显式声明：

```typescript
// 方式 1: 导出 pluginName 常量
export const pluginName = 'my-awesome-plugin'

// 方式 2: 使用 definePlugin 声明式 API
import { definePlugin } from '@zhin.js/core'

export default definePlugin({
  name: 'my-awesome-plugin',
  setup(plugin) {
    // 在这里使用 plugin 注册命令、工具等
  },
})

// 方式 3: 手动设置
const plugin = usePlugin()
plugin.setName('my-awesome-plugin')
```

### Feature（特性抽象）

Feature 是 Zhin.js 的核心扩展机制。所有内置功能均继承自 `Feature` 抽象基类，提供统一的注册/注销、插件归属追踪、JSON 序列化和变更事件通知能力。

```
Feature (抽象基类)
├── CommandFeature    — 消息命令       addCommand()
├── ToolFeature       — AI 可调用工具   addTool()
├── SkillFeature      — 技能记录       Agent 从 SKILL.md 注入
├── CronFeature       — 定时任务       addCron()
├── DatabaseFeature   — 数据模型       defineModel()
├── ComponentFeature  — 消息组件       addComponent()
├── ConfigFeature     — 插件配置       addConfig()
└── PermissionFeature — 权限管理
```

每个 Feature 都会在 `Plugin.prototype` 上注入对应的扩展方法（如 `addCommand`、`addTool`），插件通过 `usePlugin()` 获取这些方法。

Feature 支持变更事件监听，依赖方可实时响应 item 的增删：

```typescript
const toolFeature = plugin.inject('tool')
const off = toolFeature.on('add', (tool, pluginName) => {
  console.log(`工具 ${tool.name} 已注册 (来自 ${pluginName})`)
})
toolFeature.on('remove', (tool) => {
  console.log(`工具 ${tool.name} 已移除`)
})
```

### Adapter（适配器）

适配器将不同聊天平台接入 Zhin.js，统一消息收发接口。

```typescript
// 适配器通过 Adapter.register 静态注册
Adapter.register('my-platform', MyAdapter)
```

每个适配器可以通过 `addTool()` 注册平台特有工具，标准群管操作通过覆写 `IGroupManagement` 方法自动注册。

**群管理能力自动检测：** 适配器基类声明了 `IGroupManagement` 接口中的可选方法（`kickMember`、`muteMember`、`banMember` 等），子类只需覆写自己平台支持的方法，`start()` 会自动检测哪些方法已实现，生成对应的 Tool 并注册为"群聊管理"Skill。目前所有 9 个 IM 适配器（ICQQ、OneBot11、QQ 官方、Telegram、Discord、KOOK、Slack、钉钉、飞书）均已采用此模式：

```typescript
class IcqqAdapter extends Adapter<IcqqBot> {
  // 覆写标准群管方法
  async kickMember(botId: string, sceneId: string, userId: string) {
    const bot = this.bots.get(botId)
    if (!bot) throw new Error(`Bot ${botId} 不存在`)
    return bot.kickMember(Number(sceneId), Number(userId), false)
  }
  async muteMember(botId: string, sceneId: string, userId: string, duration = 600) { /* ... */ }
  async setAdmin(botId: string, sceneId: string, userId: string, enable = true) { /* ... */ }
  // ...共覆写 7 个标准方法

  async start() {
    this.registerIcqqPlatformTools()  // 头衔、公告、戳一戳等平台特有工具
    await super.start()               // 自动检测 → 生成标准 Tool → 与平台工具一起注册 Skill
  }
}
```

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
export { Plugin, usePlugin, getPlugin, definePlugin } from './plugin.js'

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
