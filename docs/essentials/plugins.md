# 插件系统

插件是 Zhin.js 的功能单元：一个带 `plugin.ts`（`definePlugin`）和一组**约定目录**的包。运行时按目录发现能力（命令、中间件、组件……），无需手动注册。

## 插件长什么样

```
my-plugin/
├── package.json      # zhin.entry / zhin.features / files（见下文）
├── plugin.ts         # definePlugin —— 插件入口
├── schema.json       # 配置 JSON Schema（可选，含默认值）
├── commands/         # 命令（defineCommand）
├── middlewares/      # 中间件（defineMiddleware）
├── components/       # 消息组件（defineComponent）
├── adapters/         # 平台适配器（defineAdapter）
├── tools/            # AI 工具（defineAgentTool）
├── skills/           # 技能（skills/<name>/SKILL.md）
├── agents/           # Agent 预设（<name>.agent.md）
├── mcp/              # MCP 定义（defineMcp）
├── pages/            # Console 客户端页面
└── src/              # 插件自己的业务代码（被以上文件 import）
```

只有 `package.json` 和 `plugin.ts` 是必需的；约定目录按需添加。

## definePlugin

`plugin.ts` 默认导出一个 `definePlugin(...)`：

```typescript
// plugin.ts（形态参考 plugins/utils/repeater）
import { definePlugin } from '@zhin.js/plugin-runtime'

export default definePlugin({
  name: 'my-plugin', // 规则：^[a-z][a-z0-9-]*$
  metadata: { displayName: 'My Plugin' },
  setup(context) {
    // 初始化资源；注册需要在卸载时执行的清理
    const timer = setInterval(() => {/* ... */}, 60_000)
    context.lifecycle.add(() => clearInterval(timer))
  },
})
```

- `name` 是包内标识；**用户可见的实例名（instanceKey）在挂载方决定**，见下文「挂载子插件」。
- `metadata`：`displayName` / `icon` / `order`，用于 Console 展示。
- `requires`：声明本插件**必须存在**的 Host Resource token；缺失时插件不会启动（见下文「Host Resources」）。

## 约定目录全表

每个约定目录对应一个 Feature 包，且必须在 `package.json` 的 `zhin.features` 里声明依赖才会生效：

| 目录 | Feature 包 | 文件形态 | 说明 |
|------|-----------|----------|------|
| `commands/` | `@zhin.js/command` | `defineCommand`，支持嵌套目录与 `[name:type=default].ts` 动态参数 | 见 [命令系统](./commands) |
| `middlewares/` | `@zhin.js/middleware` | `defineMiddleware`，目录可嵌套 | 见 [中间件](./middleware) |
| `components/` | `@zhin.js/component` | `defineComponent`，`.ts` / `.tsx`，目录可嵌套 | 命令返回 `component(name, props)` 时渲染 |
| `adapters/` | `@zhin.js/adapter` | `defineAdapter`，目录可嵌套 | 平台适配器，见 [平台适配器](/adapters/) |
| `tools/` | `@zhin.js/tool` | `defineAgentTool`，**仅顶层文件**（不递归） | AI 工具，见 [Agent 创作面](/advanced/agent-authoring) |
| `skills/` | `@zhin.js/skill` | `skills/<name>/SKILL.md` | 技能，Markdown 声明 |
| `agents/` | `@zhin.js/agent-feature` | `agents/<name>.agent.md` | Agent 预设，Markdown 声明 |
| `mcp/` | `@zhin.js/mcp-feature` | `defineMcp`，**仅顶层文件** | MCP server 定义，见 [MCP 集成](/advanced/mcp) |
| `pages/` | `@zhin.js/page`（Console） | 客户端模块，仅顶层文件 | Console 自定义页面 |

通用规则：TypeScript 类约定目录里，目录名与文件名只认 `[a-z0-9][a-z0-9-]*`，嵌套层级以 `/` 计入本地名（命令系统再映射为空格分隔的子命令）。

## 配置：schema.json

`schema.json` 用 JSON Schema（draft 2020-12）声明本插件的配置项与默认值：

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "timeout": { "type": "number", "default": 15000, "minimum": 1000 },
    "masters": { "type": "array", "items": { "type": "string" }, "default": [] }
  }
}
```

读取配置的两种位置：

```typescript
// plugin.ts —— setup 阶段（ConfigView，get() 取当前值）
setup(context) {
  const config = context.config.get()
}

// commands/*.ts —— 运行时（execute 上下文里的已解析配置）
execute({ config }) {
  if (config.timeout > 10000) { /* ... */ }
}
```

用户侧在 `zhin.config.yml` 的 `plugins.<instanceKey>` 下覆盖默认值。

## setup 生命周期

`setup(context)` 在插件装配完成、能力（命令等）生效前调用，可同步、返回 `Promise`，或返回一个 `Dispose` 清理函数：

```typescript
export default definePlugin({
  name: 'my-plugin',
  async setup(context) {
    const connection = await connect()
    // 两种等价清理方式：返回 dispose，或登记到 lifecycle
    return () => connection.close()
  },
})
```

| `context` 字段 | 说明 |
|----------------|------|
| `plugin` | 实例视图：`id` / `instanceKey` / `parent` / `root` / `role` |
| `config` | `ConfigView<T>`，`get()` 取当前配置 |
| `resources` | Host Resource 作用域（`has` / `use`） |
| `lifecycle` | `DisposeStack`，`add(dispose)` 登记卸载清理 |
| `handoff` | 热重载代际交接注册表（跨代迁移状态用） |

热重载（HMR）时框架会执行所有已登记的 dispose，再按新代码重新装配。

## Host Resources

数据库、定时任务、主动出站等能力由 Host 以 **token** 形式注入，插件在 `setup` 里按 token 取用（形态参考 `plugins/utils/rss`、`plugins/games/blackjack`）：

```typescript
import {
  definePlugin,
  databaseHostToken,
  scheduleHostToken,
  outboundHostToken,
} from '@zhin.js/plugin-runtime'

export default definePlugin({
  name: 'my-plugin',
  setup(context) {
    // 可选资源：先 has 再 use，缺失时降级
    if (context.resources.has(databaseHostToken)) {
      const db = context.resources.use(databaseHostToken)
      db.define('todos', { text: { type: 'text', nullable: false } })
    }

    if (context.resources.has(scheduleHostToken)) {
      const schedule = context.resources.use(scheduleHostToken)
      const dispose = schedule.register({
        id: 'my-plugin/tick',
        cron: '0 */5 * * * *', // 6 段 cron：秒 分 时 日 月 周
        async execute() { /* ... */ },
      })
      context.lifecycle.add(dispose)
    }
  },
})
```

| Token | 包 | 能力 |
|-------|-----|------|
| `databaseHostToken` | `@zhin.js/plugin-runtime` | 表定义与增删改查（`define` / `models.get`） |
| `scheduleHostToken` | `@zhin.js/plugin-runtime` | 6 段 cron 定时任务（`register` 返回 dispose） |
| `outboundHostToken` | `@zhin.js/plugin-runtime` | 主动出站推送（`send` / 可选 reaction、recall） |
| `httpHostToken` | `@zhin.js/host-http` | HTTP/WS 服务（Console API、自定义路由） |

资源**可选时用 `has` + `use` 降级**；**必需时**在 `definePlugin` 里声明 `requires: [databaseHostToken]`，缺失即拒绝启动。

## package.json 要求

插件包必须携带 `zhin` 清单（protocol 1）并把能力目录放进 `files`：

```json
{
  "name": "@zhin.js/plugin-my-plugin",
  "type": "module",
  "files": ["plugin.ts", "schema.json", "commands", "middlewares", "src", "lib"],
  "zhin": {
    "protocol": 1,
    "type": "plugin",
    "entry": "./plugin.ts",
    "engine": "^1.0.0",
    "runtime": "trusted",
    "features": [
      { "package": "@zhin.js/command", "api": "^1.0.0" },
      { "package": "@zhin.js/middleware", "api": "^1.0.0" }
    ],
    "plugins": []
  }
}
```

- `entry` 指向 `plugin.ts`（源码形态，运行时按需编译）。
- `features` 声明本插件使用的约定目录对应的 Feature 包；`plugins` 声明内嵌子插件。
- 发布到 npm 时确保 `files` 覆盖 `plugin.ts`、`schema.json` 与所有约定目录，并配 `prepublishOnly` 构建（仓库有对应 harness 检查）。

## 挂载子插件

使用方在**项目** `package.json` 的 `zhin.plugins` 里声明挂载，`instanceKey` 决定实例身份：

```json
{
  "zhin": {
    "plugins": [
      { "package": "@zhin.js/plugin-qrcode", "instanceKey": "qrcode" },
      { "package": "@zhin.js/adapter-icqq", "instanceKey": "icqq-2" }
    ]
  }
}
```

instanceKey 的规则与影响：

- 命名规则 `[a-z0-9][a-z0-9-]*`；同一包可挂多个实例（`icqq` / `icqq-2`）。
- 它是插件命令的前缀（`qrcode` 插件的 `commands/scan/[url:string].ts` → `/qrcode scan <url>`）。
- 它是 `zhin.config.yml` 里 `plugins.<instanceKey>` 的配置键。

::: info legacy 路径
旧的 `usePlugin()` / `plugin.yml` / `addCommand` 写法属于旧 Feature registry（`zhin dev` 路径）；新插件请使用本文的 `definePlugin` + 约定目录结构。
:::

## 下一步

- [命令系统](./commands) — `defineCommand`、文件路由参数与返回值
- [中间件与消息调度](./middleware) — `defineMiddleware` 与 Runtime Message
- [配置文件](./configuration) — `zhin.config.yml` 全量配置项
- [examples/minimal-bot](https://github.com/zhinjs/zhin/tree/main/examples/minimal-bot) — 最小可运行插件项目
- [plugins/utils/rss](https://github.com/zhinjs/zhin/tree/main/plugins/utils/rss) — schema.json + schedule + outbound 的真实插件
