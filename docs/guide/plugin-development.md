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

详见 [插件系统](/essentials/plugins) 和 [API 参考](/api/)。

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
  name: 'get_time',
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

### 使用 Web 控制台调试

启动开发模式后访问 `http://localhost:8086`，在 Web 控制台中可以：

- 查看插件加载状态
- 查看 Feature 注册情况（命令、工具、定时任务等）
- 实时查看日志输出
- 监控内存使用和消息统计

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

## 插件开发最佳实践

### ✅ 推荐做法

- **使用 TypeScript** — 获得完整的类型提示和编译时检查
- **声明类型扩展** — 让其他插件获得类型提示（`declare module 'zhin.js'`）
- **使用 `useContext`** — 确保依赖的服务就绪后再使用
- **返回清理函数** — 在 `onDispose` 中清理定时器、连接等资源
- **使用 `logger`** — 通过插件自带的 logger 输出日志，便于调试
- **添加 `addConfig`** — 让用户可以通过配置文件自定义插件行为

### ❌ 避免做法

- **不要使用 `any` 类型** — 保持类型安全
- **不要泄露资源** — 插件卸载时确保清理所有资源
- **不要硬编码配置** — 使用 `addConfig` 或环境变量
- **不要阻塞主线程** — 耗时操作使用 `async/await`

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
