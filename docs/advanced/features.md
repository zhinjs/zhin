# Feature 系统

Feature 是 Zhin.js 的核心抽象，统一管理框架中各种可扩展的功能模块。

## 什么是 Feature

Feature 解决的问题是：框架有很多可扩展的功能（命令、工具、定时任务、配置等），每种功能都需要：
- 注册/注销机制
- 按插件隔离
- 序列化为 JSON（HTTP API 使用）
- 向插件注入扩展方法

Feature 提供了统一的基类，所有内置功能都继承自它。

## 内置 Feature 列表

| Feature | name | 插件扩展方法 | 说明 |
|---------|------|-------------|------|
| `CommandFeature` | `command` | `addCommand()` | 命令注册与匹配 |
| `ToolFeature` | `tool` | `addTool()` | AI 工具注册 |
| `SkillFeature` | `skill` | `declareSkill()` | AI 技能声明 |
| `ConfigFeature` | `config` | `addConfig()` | 配置项注册 |
| `CronFeature` | `cron` | `addCron()` | 定时任务管理 |
| `PermissionFeature` | `permission` | `addPermission()` | 权限规则管理 |
| `DatabaseFeature` | `database` | `defineModel()` | 数据库模型定义 |
| `ComponentFeature` | `component` | `addComponent()` | 消息组件注册 |

## Feature 基类 API

```typescript
abstract class Feature<T> {
  // 元数据（子类必须实现）
  abstract readonly name: string   // Feature 名称
  abstract readonly icon: string   // 图标（用于 UI）
  abstract readonly desc: string   // 描述

  // 核心操作
  add(item: T, pluginName: string): () => void   // 添加项目，返回 dispose
  remove(item: T): boolean                        // 移除项目

  // 查询
  getByPlugin(pluginName: string): T[]            // 按插件获取
  get items(): T[]                                // 所有项目

  // 序列化（HTTP API 使用）
  toJSON(pluginName?: string): FeatureJSON

  // 插件扩展（自动注入到 Plugin.prototype）
  get extensions(): Record<string, Function>

  // 生命周期（可选）
  mounted?(plugin: Plugin): void
  dispose?(): void
}
```

## 工作原理

### 1. 注册 Feature

Feature 通过 `provide()` 注册到框架中：

```typescript
// 框架启动时自动注册（setup.ts）
provide(new CommandFeature())
provide(new ToolFeature())
provide(new SkillFeature())
// ...
```

### 2. 注入扩展方法

注册后，Feature 的 `extensions` 会自动注入到所有插件的 API 中。例如 CommandFeature 的 extensions：

```typescript
class CommandFeature extends Feature<MessageCommand> {
  get extensions() {
    const feature = this
    return {
      addCommand(command: MessageCommand) {
        const plugin = getPlugin()
        const dispose = feature.add(command, plugin.name)
        plugin.recordFeatureContribution(feature.name, command.name)
        plugin.onDispose(dispose)
        return dispose
      }
    }
  }
}
```

这就是为什么插件中可以直接调用 `addCommand()`、`addTool()` 等方法。

### 3. 按插件跟踪

每个 Feature 记录哪些项目属于哪个插件：

```typescript
feature.getByPlugin('my-plugin')  // 获取 my-plugin 贡献的所有项目
```

当插件卸载时，其贡献的所有项目会自动清理。

### 4. JSON 序列化

Feature 可以序列化为 JSON，供 HTTP API 和 Web 控制台使用：

```typescript
feature.toJSON('my-plugin')
// {
//   name: 'command',
//   icon: 'Terminal',
//   desc: '命令',
//   count: 3,
//   items: [{ name: 'hello', desc: '打招呼' }, ...]
// }
```

## 在插件中使用 Feature

### 通过扩展方法（推荐）

```typescript
const { addCommand, addTool, addCron, declareSkill } = usePlugin()

// 直接调用扩展方法
addCommand(new MessageCommand('hello').action(() => '你好'))
addTool({ name: 'my_tool', ... })
addCron(new Cron('0 8 * * *', () => {}))
declareSkill({ description: '...' })
```

### 通过 inject（高级）

```typescript
const { inject } = usePlugin()

const commandFeature = inject('command')
const allCommands = commandFeature?.items  // 获取所有命令
```

## 自定义 Feature

你可以创建自己的 Feature：

```typescript
import { Feature, FeatureJSON, usePlugin, getPlugin } from 'zhin.js'

// 定义项目类型
interface Webhook {
  name: string
  url: string
  events: string[]
}

// 实现 Feature
class WebhookFeature extends Feature<Webhook> {
  readonly name = 'webhook' as const
  readonly icon = 'Link'
  readonly desc = 'Webhook'

  // 自定义方法
  trigger(name: string, data: any) {
    const webhook = this.items.find(w => w.name === name)
    if (webhook) {
      // 发送 HTTP 请求...
    }
  }

  toJSON(pluginName?: string): FeatureJSON {
    const list = pluginName ? this.getByPlugin(pluginName) : this.items
    return {
      name: this.name,
      icon: this.icon,
      desc: this.desc,
      count: list.length,
      items: list.map(w => ({ name: w.name, desc: w.url })),
    }
  }

  // 注入插件扩展方法
  get extensions() {
    const feature = this
    return {
      addWebhook(webhook: Webhook) {
        const plugin = getPlugin()
        const dispose = feature.add(webhook, plugin.name)
        plugin.recordFeatureContribution(feature.name, webhook.name)
        plugin.onDispose(dispose)
        return dispose
      }
    }
  }
}

// 注册
const { provide } = usePlugin()
provide(new WebhookFeature())
```

注册后，其他插件就可以使用 `addWebhook()` 方法了：

```typescript
// 在另一个插件中
const { addWebhook } = usePlugin()

addWebhook({
  name: 'deploy',
  url: 'https://example.com/webhook',
  events: ['push'],
})
```
