# 插件开发指南

> **前置**：先跑通 [快速开始](/getting-started/)，再读本页。

## ⚠️ 必读陷阱

在写任何插件代码之前，请记住这两条规则：

| 规则 | 说明 | 违反后果 |
|------|------|----------|
| `usePlugin()` 必须在文件顶层 | 不能放在函数、回调、async 函数里 | 框架通过调用栈检测文件路径，异步调用会丢失上下文 |
| 运行时回调禁止调 `getPlugin()` | 中间件、命令 action、工具 execute 里不能用 | AsyncLocalStorage 跨 await 丢失上下文，线上报错 |

**正确写法**：在注册时捕获闭包

```typescript
const plugin = usePlugin()
const { root, logger, addCommand } = plugin

addCommand(new MessageCommand('hi').action(() => {
  // ✅ 用闭包里的 plugin/root/logger
  logger.info('有人打招呼')
  return 'hi'
}))
```

**错误写法**：运行时调 getPlugin

```typescript
addCommand(new MessageCommand('hi').action(() => {
  // ❌ getPlugin() 在这里会丢失上下文
  getPlugin().logger.info('...')
}))
```

## 插件 API 速查

```typescript
const {
  addCommand,      // 添加命令
  addTool,         // 添加 AI 工具
  addMiddleware,   // 添加中间件
  addCron,         // 添加定时任务
  addComponent,    // 添加消息组件
  defineModel,     // 定义数据模型
  provide,         // 注册服务
  inject,          // 注入服务
  useContext,      // 等待服务就绪
  onMounted,       // 挂载完成
  onDispose,       // 卸载清理
  logger,          // 日志
} = usePlugin()
```

## 开发模式

### 数据库

```typescript
declare module 'zhin.js' {
  interface Models { notes: { id: number; text: string } }
}

defineModel('notes', {
  id: { type: 'integer', primary: true },
  text: { type: 'string' },
})

useContext('database', (db) => {
  const notes = db.models.get('notes')
  addCommand(new MessageCommand('note <text:text>').action(async (_, r) => {
    await notes.insert({ text: r.params.text })
    return '✅ 已保存'
  }))
})
```

### AI 工具

```typescript
addTool({
  name: 'get_weather',
  description: '查询天气',
  parameters: { city: { type: 'string', description: '城市名' } },
  execute: async ({ city }) => `${city}今天晴，25°C`
})
```

### 定时任务

```typescript
addCron('0 9 * * *', async () => {
  // 每天早上 9 点
  await adapter.sendMessage('group:123', '早安！')
})
```

### 依赖注入

```typescript
// 提供方
provide({ name: 'cache', value: new Map() })

// 使用方 — 等服务就绪后执行
useContext('cache', (cache) => {
  cache.set('key', 'value')
})
```

## 创建插件项目

### CLI 脚手架（推荐）

```bash
npx zhin new my-plugin
```

生成标准目录结构：`src/`、`tests/`、`skills/`、`package.json`、`README.md`。

### 手动创建

在 `src/plugins/` 下创建 `.ts` 文件，然后在 `zhin.config.yml` 的 `plugins` 列表中添加即可。

::: tip 单文件 vs 目录插件
- **单文件**：适合简单功能，直接在 `src/plugins/` 下创建
- **目录**：适合发布到 npm，用 `npx zhin new` 创建
:::

## 测试

```typescript
import { describe, it, expect } from 'vitest'

describe('my-plugin', () => {
  it('should register commands', async () => {
    // 测试插件加载和命令注册
  })
})
```

运行：`pnpm vitest run`

## 构建与发布

```bash
pnpm build          # 构建
pnpm changeset      # 创建变更记录
pnpm changeset version  # 升版本
pnpm changeset publish   # 发布到 npm
```

## 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| 命令不生效 | 插件没在配置文件中注册 | 在 `zhin.config.yml` 的 `plugins` 列表添加 |
| 热重载后报错 | `usePlugin()` 不在顶层 | 移到文件顶层 |
| 数据库操作报错 | 数据库未就绪就使用 | 用 `useContext('database', ...)` 等待 |
| 类型报错 | 导入路径缺 `.js` 后缀 | `import { x } from './y.js'` |

## 下一步

- [消息如何流转](/essentials/message-flow) — 理解消息进出
- [配置文件](/essentials/configuration) — 所有配置项
- [平台适配器](/adapters/) — 各平台接入配置
- [AI 模块](/advanced/ai) — 接入大模型
