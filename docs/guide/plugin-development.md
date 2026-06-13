# 插件开发、测试与发布

本指南覆盖 Zhin.js 插件的完整生命周期：**创建 → 开发 → 测试 → 构建 → 发布**。

> **前置知识**：阅读本页前建议先了解 [核心概念](/essentials/) 和 [插件系统](/essentials/plugins)。

## 创建插件

### 方式一：CLI 脚手架（推荐）

在你的 Zhin.js 项目根目录执行：

```bash
npx zhin new my-plugin
```

系统会进入交互式向导，依次选择：

```
? 请输入插件名称: my-plugin
? 请选择插件类型:
  > 普通插件 (Normal)
    服务 (Service)
    适配器 (Adapter)
```

生成的目录结构：

```
plugins/my-plugin/
├── src/
│   └── index.ts        # 插件入口
├── client/
│   ├── index.tsx       # 客户端入口（Web 控制台页面）
│   └── pages/          # 页面组件
├── tests/
│   └── index.test.ts   # 单元测试
├── skills/
│   └── my-plugin/
│       └── SKILL.md    # AI 技能声明
├── package.json        # 包信息
├── tsconfig.json       # TypeScript 配置
└── README.md           # 插件说明
```

### 方式二：手动创建

在 `src/plugins/` 目录下创建一个 `.ts` 文件即可：

```typescript
// src/plugins/hello.ts
import { usePlugin, MessageCommand } from 'zhin.js'

const { addCommand } = usePlugin()

addCommand(
  new MessageCommand('hello')
    .desc('打个招呼')
    .action(() => '你好！')
)
```

然后在配置文件中启用：

```yaml
# zhin.config.yml
plugins:
  - hello
```

::: tip 单文件 vs 目录插件
- **单文件插件**：适合简单功能，直接在 `src/plugins/` 下创建 `.ts` 文件
- **目录插件**：适合复杂功能或需要发布到 npm，使用 `npx zhin new` 创建
:::

## 插件 API

通过 `usePlugin()` 获取插件实例，它提供以下核心 API：

```typescript
import { usePlugin, MessageCommand, Cron } from 'zhin.js'

const {
  // 命令
  addCommand,      // 添加消息命令
  // AI 工具
  addTool,         // 添加 AI 可调用的工具
  // 中间件
  addMiddleware,   // 添加消息中间件
  // 定时任务
  addCron,         // 添加定时任务
  // 组件
  addComponent,    // 添加消息组件
  // 数据库
  defineModel,     // 定义数据模型
  // 配置
  addConfig,       // 注册插件配置项
  // 依赖注入
  provide,         // 注册服务
  inject,          // 注入已有服务
  useContext,       // 等待服务就绪后执行
  // 生命周期
  onMounted,       // 插件挂载完成
  onDispose,       // 插件卸载时
  // 工具
  logger,          // 日志
} = usePlugin()
```

详见 [插件系统](/essentials/plugins) 和 API 参考（`pnpm docs:api` 本地生成）。

## 开发示例

### 基础命令插件

```typescript
import { usePlugin, MessageCommand } from 'zhin.js'

const { addCommand } = usePlugin()

// 简单命令
addCommand(
  new MessageCommand('ping')
    .desc('检查机器人是否在线')
    .action(() => 'pong!')
)

// 带参数的命令
addCommand(
  new MessageCommand('echo <message:string>')
    .desc('回显消息')
    .action((_, result) => `你说：${result.params.message}`)
)

// 带可选参数的命令
addCommand(
  new MessageCommand('greet [name:string]')
    .desc('问候某人')
    .action((_, result) => {
      const name = result.params.name || '世界'
      return `你好，${name}！`
    })
)
```

### 使用数据库

```typescript
import { usePlugin, MessageCommand } from 'zhin.js'

// 1. 声明模型类型
declare module 'zhin.js' {
  interface Models {
    notes: { id: number; text: string; createdAt: string }
  }
}

const { defineModel, addCommand, useContext } = usePlugin()

// 2. 定义数据模型
defineModel('notes', {
  id: { type: 'integer', primary: true },
  text: { type: 'string' },
  createdAt: { type: 'string', default: () => new Date().toISOString() }
})

// 3. 等待数据库就绪后注册命令
useContext('database', (db) => {
  const notes = db.models.get('notes')

  addCommand(
    new MessageCommand('note <text:string>')
      .desc('添加笔记')
      .action(async (_, result) => {
        await notes.insert({ text: result.params.text })
        return '✅ 笔记已保存'
      })
  )

  addCommand(
    new MessageCommand('notes')
      .desc('查看所有笔记')
      .action(async () => {
        const list = await notes.select()
        if (!list.length) return '暂无笔记'
        return list.map((n, i) => `${i + 1}. ${n.text}`).join('\n')
      })
  )
})
```

### 注册 AI 工具

```typescript
import { usePlugin } from 'zhin.js'

const { addTool } = usePlugin()

addTool({
  name: 'roll_dice',
  description: '掷骰子，返回 1~6 的随机数',
  parameters: {},
  execute: async () => {
    return String(Math.ceil(Math.random() * 6))
  }
})

addTool({
  name: 'show_clock',
  description: '获取当前时间',
  parameters: {},
  execute: async () => {
    return new Date().toLocaleString('zh-CN')
  }
})
```

#### 文件化 Tool（*.tool.md）

对于简单工具，可以不写代码，直接在 `tools/` 目录放置 `*.tool.md` 文件：

```text
src/plugins/my-plugin/
└── tools/
    └── roll-dice.tool.md
```

```markdown
---
name: roll_dice
description: 掷骰子，返回 1~6 的随机数
tags: [utility, game]
---

🎲 结果：你掷出了一个骰子！
```

带执行逻辑的工具使用 `handler` 字段指向 TypeScript 文件：

```text
tools/
└── weather/
    ├── weather.tool.md
    └── handler.ts
```

```markdown
---
name: get_weather
description: 查询城市天气
parameters:
  city:
    type: string
    description: 城市名称
    required: true
handler: ./handler.ts
---
```

```typescript
// tools/weather/handler.ts
export default async function(args: { city: string }) {
  const res = await fetch(`https://api.example.com/weather?city=${args.city}`)
  const data = await res.json()
  return `${args.city}: ${data.temp}°C, ${data.description}`
}
```

框架自动扫描 `tools/` 目录，支持热重载。程序化 `addTool()` 注册的同名工具优先。详见 [工具与技能](/advanced/tools-skills)。

### 服务插件（提供 Context）

```typescript
import { usePlugin } from 'zhin.js'

const { provide } = usePlugin()

// 提供一个计数器服务
provide({
  name: 'counter',
  description: '全局计数器服务',
  value: {
    counts: new Map<string, number>(),
    increment(key: string) {
      const val = (this.counts.get(key) || 0) + 1
      this.counts.set(key, val)
      return val
    },
    get(key: string) {
      return this.counts.get(key) || 0
    }
  }
})

// 声明类型，让其他插件获得类型提示
declare module 'zhin.js' {
  namespace Plugin {
    interface Contexts {
      counter: {
        counts: Map<string, number>
        increment(key: string): number
        get(key: string): number
      }
    }
  }
}
```

其他插件即可注入使用：

```typescript
const { useContext } = usePlugin()

useContext('counter', (counter) => {
  const count = counter.increment('visits')
  console.log(`第 ${count} 次访问`)
})
```

## 测试插件

### 使用 Sandbox 适配器实时测试

最快的测试方式是在开发模式下使用内置的 Sandbox 适配器：

```bash
pnpm dev
```

启动后，直接在终端输入消息进行测试：

```
> ping
机器人: pong!

> echo 测试消息
机器人: 你说：测试消息
```

代码修改保存后会**自动热重载**，无需重启。

### 编写单元测试

Zhin.js 使用 [Vitest](https://vitest.dev/) 作为测试框架。在插件目录下创建测试文件：

```typescript
// src/plugins/my-plugin/__tests__/index.test.ts
import { describe, it, expect } from 'vitest'
import { MessageCommand } from 'zhin.js'

describe('my-plugin', () => {
  it('should create ping command', () => {
    const cmd = new MessageCommand('ping')
      .desc('检查在线')
      .action(() => 'pong!')

    expect(cmd).toBeDefined()
  })

  it('should handle echo command with params', () => {
    const cmd = new MessageCommand('echo <message:string>')
      .desc('回显消息')
      .action((_, result) => `你说：${result.params.message}`)

    expect(cmd).toBeDefined()
  })
})
```

运行测试：

```bash
# 运行所有测试
pnpm test

# 监听模式（修改后自动重新测试）
pnpm test:watch

# 生成覆盖率报告
pnpm test:coverage
```

### 使用 Remote Console 调试

启动 `pnpm dev` 后，打开 **[console.zhin.dev](https://console.zhin.dev)**（或本地 [zhin-console](https://github.com/zhinjs/zhin-console) 开发服），API Base 填 `http://127.0.0.1:8086`，Token 与 `HTTP_TOKEN` 一致。在控制台中可以：

- 查看插件加载状态
- 查看 Feature 注册情况（命令、工具、定时任务等）
- 实时查看日志输出
- 监控内存使用和消息统计

管理界面在 [Remote Console](https://console.zhin.dev) 登录，API Base 填 Host 监听地址。见 [console-remote.md](../console-remote.md)。

## 构建插件

将插件构建为可发布的 npm 包：

```bash
# 在插件目录下构建
npx zhin build

# 清理后重新构建
npx zhin build --clean

# 生产模式构建（跳过 sourcemap）
npx zhin build --production
```

构建完成后，`lib/` 目录包含编译后的 JavaScript 文件。

## 发布插件

### 1. 完善 package.json

确保 `package.json` 包含必要的信息：

```json
{
  "name": "zhin.js-my-plugin",
  "version": "1.0.0",
  "description": "我的 Zhin.js 插件",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/index.d.ts",
  "exports": {
    ".": {
      "types": "./lib/index.d.ts",
      "development": "./src/index.ts",
      "import": "./lib/index.js"
    },
    "./package.json": "./package.json"
  },
  "files": [
    "src",
    "lib",
    "client",
    "dist",
    "skills",
    "README.md"
  ],
  "keywords": [
    "zhin.js",
    "plugin"
  ],
  "peerDependencies": {
    "zhin.js": ">=1.0.0"
  }
}
```

::: tip 命名规范
- 官方插件：`@zhin.js/<name>`
- 社区插件：`zhin.js-<name>` 或你自己的 scope

带有 `zhin.js` 和 `plugin` 关键词的包，或以 `zhin.js-` 开头的包名，会在 `npx zhin search` 中被发现。
:::

### 2. 编写 README

为你的插件编写清晰的 README，至少包括：

- 插件功能描述
- 安装方法
- 配置说明
- 使用示例
- 可用命令列表

### 3. 发布到 npm

```bash
# 发布插件
npx zhin pub

# 或使用标准 npm 命令
npm publish

# 带标签发布（如测试版）
npx zhin pub --tag beta

# 模拟发布（不实际上传）
npx zhin pub --dry-run
```

### 4. 验证发布

发布成功后，其他用户可以通过以下方式使用你的插件：

```bash
# 搜索插件
npx zhin search my-plugin

# 查看插件信息
npx zhin info zhin.js-my-plugin

# 安装插件
npx zhin install zhin.js-my-plugin
```

## 高级模式

### 中间件拦截

中间件可以拦截消息、注入上下文或记录日志。**必须调用 `next()` 才能继续管线**：

```typescript
import { usePlugin } from 'zhin.js'

const { addMiddleware, logger } = usePlugin()

// 日志中间件
addMiddleware(async (message, next) => {
  const start = Date.now()
  logger.info(`收到: ${message.$content}`)
  await next()
  logger.info(`处理完成: ${Date.now() - start}ms`)
}, 'logger')

// 权限拦截中间件
addMiddleware(async (message, next) => {
  if (!message.$sender.isMaster && message.$content.startsWith('/admin')) {
    await message.$reply('权限不足')
    return // 不调用 next()，中断管线
  }
  await next()
}, 'guard')
```

::: warning 中间件执行顺序
内置命令中间件始终先执行。用户添加的中间件在命令处理**之后**运行。如果消息已匹配命令并回复，用户中间件仍会执行（`next()` 返回后）。
:::

### 定时任务

```typescript
import { usePlugin, Cron } from 'zhin.js'

const { addCron, logger } = usePlugin()

// 每 5 分钟执行一次
addCron(new Cron('*/5 * * * *', async () => {
  logger.info('定时任务执行')
  await checkFeeds()
}))

// 每天早上 9 点
addCron(new Cron('0 9 * * *', async () => {
  await sendDailyBrief()
}))
```

定时任务在 `addCron()` 时自动启动，插件卸载时自动停止。标准 5 字段 cron 格式：`分 时 日 月 周`。

### Schema 配置声明

`declareConfig` 使用 Schema 验证配置，比 `addConfig` 更强大：

```typescript
import { usePlugin, Schema } from 'zhin.js'

const { declareConfig, addCommand } = usePlugin()

const config = declareConfig('my-plugin', Schema.object({
  threshold: Schema.number()
    .default(3)
    .min(2)
    .max(10)
    .description('触发阈值'),
  cooldown: Schema.number()
    .default(30_000)
    .description('冷却时间 (ms)'),
  enabled: Schema.boolean()
    .default(true)
    .description('是否启用'),
}))

// config 现在是类型安全的：{ threshold: number, cooldown: number, enabled: boolean }
// 用户可在 zhin.config.yml 中覆盖：
// my-plugin:
//   threshold: 5
//   cooldown: 60000
```

### JSX 组件

```typescript
import { usePlugin, defineComponent } from 'zhin.js'

const { addComponent } = usePlugin()

const WeatherCard = defineComponent(
  async function WeatherCard({ city }: { city: string }) {
    const weather = await fetchWeather(city)
    return `🌤️ ${city}: ${weather.temp}°C, ${weather.desc}`
  },
  'WeatherCard'
)

addComponent(WeatherCard)

// 使用：<WeatherCard city="北京" />
```

### 技能声明（SKILL.md）

在 `skills/` 目录放置 `SKILL.md` 文件，AI 会自动发现并使用：

```text
plugins/my-plugin/
└── skills/
    └── my-skill/
        └── SKILL.md
```

```markdown
# my-skill

## When to use
- 用户问天气时
- 用户说"温度"、"天气"等关键词时

## Tools
- get_weather: 查询城市天气

## Instructions
1. 从用户消息中提取城市名
2. 调用 get_weather 工具
3. 用自然语言回复结果
```

### `useContext` 进阶

`useContext` 有几个非直觉的行为：

```typescript
const { useContext } = usePlugin()

useContext('database', 'icqq', (db, icqq) => {
  // 1. 两个 context 都就绪时触发
  // 2. 如果任一 context 被卸载后重新创建，会重新触发
  
  const cleanup = db.models.get('notes')
  
  // 3. 返回清理函数 — 当 context 被卸载时调用
  return () => {
    // 清理在此 context 下注册的资源
  }
})
```

### 提供自定义服务（provide + extensions）

```typescript
const { provide } = usePlugin()

provide({
  name: 'counter',
  description: '计数器服务',
  value: { counts: new Map<string, number>() },
  // mounted: context 就绪后调用
  mounted: async (plugin) => {
    plugin.logger.info('Counter service mounted')
    return { counts: new Map() }
  },
  // dispose: 插件卸载时调用
  dispose: async (value) => {
    value.counts.clear()
  },
  // extensions: 注入到 Plugin.prototype，所有插件可用
  extensions: {
    incrementCounter(key: string) {
      const svc = this.inject('counter')
      const val = (svc.counts.get(key) || 0) + 1
      svc.counts.set(key, val)
      return val
    }
  }
})

// 声明类型扩展
declare module 'zhin.js' {
  namespace Plugin {
    interface Contexts {
      counter: { counts: Map<string, number> }
    }
  }
}
```

## 常见陷阱

| 陷阱 | 说明 |
|------|------|
| `usePlugin()` 不在顶层调用 | 必须在模块顶层调用，不能在回调、async 函数或动态 import 内。框架通过调用栈检测文件路径。 |
| 忘记调用 `next()` | 中间件不调用 `next()` 会中断管线，后续中间件和命令都不会执行。 |
| `declareConfig` 返回值不是响应式的 | 返回的是合并后的快照，运行时配置文件修改不会自动更新返回值。 |
| 工具名冲突 | 全局唯一。同名工具会覆盖旧的。 |
| 热重载仅开发模式 | `pnpm dev` 才有效。`pnpm start` 不监听文件变化。 |
| `useContext` 回调重复触发 | 任一 context 被卸载重装时，整个回调会重新执行。用 `onDispose` 返回的清理函数处理副作用。 |

## 插件开发最佳实践

### ✅ 推荐做法

- **`usePlugin()` 在模块顶层调用** — 不能在回调、async 函数或动态 import 内
- **使用 `declareConfig` + Schema** — 比 `addConfig` 更安全，有类型校验和 Web 控制台支持
- **`useContext` 等待依赖** — 确保依赖的服务就绪后再注册命令/工具
- **`useContext` 返回清理函数** — 当 context 被卸载时自动调用
- **`onDispose` 清理资源** — 定时器、连接、订阅等
- **声明 `declare module`** — 让其他插件获得类型提示
- **使用 `logger`** — 不要用 `console.log`，插件自带的 logger 有上下文标识
- **中间件命名** — `addMiddleware(fn, 'name')` 方便调试和日志追踪
- **工具名全局唯一** — snake_case 命名，避免冲突

### ❌ 避免做法

- **`usePlugin()` 不在顶层** — 框架通过调用栈检测文件路径，异步调用会失败
- **中间件不调用 `next()`** — 会中断管线，后续处理不会执行
- **`declareConfig` 后修改返回值** — 返回的是快照，不会同步到配置文件
- **插件卸载不清理资源** — 定时器、连接、事件监听器必须在 `onDispose` 中清理
- **同步阻塞主线程** — 文件读写、网络请求使用 `async/await`
- **硬编码配置** — 使用 `declareConfig` 或环境变量

### 完整插件模板

```typescript
import { usePlugin, MessageCommand } from 'zhin.js'

// 类型扩展
declare module 'zhin.js' {
  interface Models {
    my_data: { id: number; value: string }
  }
}

const {
  addCommand,
  addTool,
  addConfig,
  defineModel,
  useContext,
  onMounted,
  onDispose,
  logger
} = usePlugin()

// 注册配置
addConfig('my-plugin', {
  prefix: '!',
  maxResults: 10
})

// 定义数据模型
defineModel('my_data', {
  id: { type: 'integer', primary: true },
  value: { type: 'string' }
})

// 注册 AI 工具
addTool({
  name: 'my_tool',
  description: '我的工具',
  parameters: {},
  execute: async () => '工具执行结果'
})

// 生命周期
onMounted(() => {
  logger.info('插件已启动')
})

onDispose(() => {
  logger.info('插件已卸载')
})

// 使用数据库
useContext('database', (db) => {
  const model = db.models.get('my_data')

  addCommand(
    new MessageCommand('mycommand <value:string>')
      .desc('我的命令')
      .action(async (_, result) => {
        await model.insert({ value: result.params.value })
        return '✅ 完成'
      })
  )
})
```

## 常见问题

### 插件没有加载

1. **单文件插件**：确认文件在 `src/plugins/` 目录下，`zhin.config.yml` 的 `plugins` 中使用文件名（如 `example`）
2. **包插件**（`zhin new` 创建）：确认 `zhin.config.yml` 的 `plugins` 中使用完整包名（如 `zhin.js-my-plugin`）
3. 查看终端日志是否有加载错误

### 热重载不生效

确保使用开发模式启动（`pnpm dev`），而不是生产模式（`pnpm start`）。

### 发布后用户搜索不到

确保 `package.json` 的 `keywords` 中包含 `zhin` 和 `zhin-plugin`。

### 类型提示不完整

使用 `declare module 'zhin.js'` 扩展类型声明，详见上方示例。

## 下一步

- [命令系统](/essentials/commands) — 学习更多命令语法
- [Feature 系统](/advanced/features) — 了解 Feature 抽象
- [AI 模块](/advanced/ai) — 集成大模型能力
- [工具与技能](/advanced/tools-skills) — 注册 AI 工具和声明技能
- [贡献指南](/contributing) — 向框架本身贡献代码
