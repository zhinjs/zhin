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
import { definePlugin } from 'zhin.js/plugin-runtime'

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

每个约定目录对应一个 Feature 包。对 **Root 应用项目**，官方 Stable Features（`adapter` / `command` / `component` / `middleware`）写在 `@zhin.js/core` 的 `package.json#zhin.features` 中；Root 直列 core 或经 `zhin.js` 间接依赖时由 Project Graph 继承，不必在 Root 重复声明（见 [ADR 0053](/adr/0053-platform-stable-features)）。其余 Feature，以及所有非 Root Plugin 包，仍须在 `dependencies` + `zhin.features` 中成对声明。

创作面 import 推荐走 `zhin.js/*` 便利入口（如 `zhin.js/command`），勿再直列 `@zhin.js/command` 等零件包。

| 目录 | Feature 包 | 文件形态 | 说明 |
|------|-----------|----------|------|
| `commands/` | `@zhin.js/command`（Root 平台默认） | `defineCommand`，支持嵌套目录与 `[name:type=default].ts` 动态参数 | 见 [命令系统](./commands) |
| `middlewares/` | `@zhin.js/middleware` | `defineMiddleware`，目录可嵌套 | 见 [中间件](./middleware) |
| `components/` | `@zhin.js/component`（Root 平台默认） | `defineComponent`，`.ts` / `.tsx`，目录可嵌套 | 命令返回 `component(name, props)` 时渲染 |
| `adapters/` | `@zhin.js/adapter`（Root 平台默认） | `defineAdapter`，目录可嵌套 | 平台适配器，见 [平台适配器](/adapters/) |
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
} from 'zhin.js/plugin-runtime'

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
| `agentToolsHostToken` | `@zhin.js/plugin-runtime` | 向 Agent Host 注册 AI 工具（`register(tool)`；形态参考 `plugins/utils/lottery/agent/runtime-tools.ts`） |
| `htmlRendererToken` | `@zhin.js/plugin-runtime` | HTML/组件渲染为图片（卡片类出站） |
| `runtimeEventPublisherToken` | `@zhin.js/plugin-runtime` | 向 Console SSE 发布运行时事件（`endpoint:message` 等） |
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

使用方在**项目** `package.json` 的 `zhin.plugins` 里声明挂载，`instanceKey` 决定实例身份。`package` 支持**两种来源**：

```json
{
  "zhin": {
    "plugins": [
      { "package": "@zhin.js/plugin-qrcode", "instanceKey": "qrcode" },
      { "package": "@zhin.js/adapter-icqq", "instanceKey": "icqq-2" },
      { "package": "./plugins/greeter", "instanceKey": "greeter" }
    ]
  }
}
```

- **npm 包名**：来自 `dependencies`（workspace 协议或 registry 版本均可），按 node_modules 解析。
- **`./` 相对路径**：monorepo 本地插件目录（相对声明方的包根，不可 `..` 越界），目录里就是一个带 `package.json`（含 zhin 清单）的插件包，**无需**写进 dependencies、无需发 npm。嵌套也可以——子插件自己还能用 `./` 再挂本地子插件。

instanceKey 的规则与影响：

- 命名规则 `[a-z0-9][a-z0-9-]*`；同一包可挂多个实例（`icqq` / `icqq-2`）。
- 它是插件命令的前缀（`qrcode` 插件的 `commands/scan/[url:string].ts` → `/qrcode scan <url>`）。
- 它是 `zhin.config.yml` 里 `plugins.<instanceKey>` 的配置键。

## 独立启动：插件即应用

任何 `type: "plugin"` 的包本身就是合法 Root——**一个插件 + 一个 `zhin.config.yml` 就能启动**，不需要再包一层项目壳：

```bash
cd plugins/adapters/sandbox   # 或任何插件包目录
# zhin.config.yml 里用 plugin: 段配置自己（Root 读自己的 schema.json）
zhin runtime start
```

```yaml
# plugins/adapters/sandbox/zhin.config.yml
log_level: info
http:
  port: 18099
  token: dev-token
plugin:                    # Root 自己的配置（对应本包 schema.json）
  endpoints:
    - context: sandbox
      name: sb
      owner: sb-user
```

此时插件自己的 `zhin.features` 就是它需要的全部 Feature 面（不依赖 Root 继承），
`zhin.plugins` 里的子插件照常挂载——"插件 = 最小可运行单元"由此成立。

## definePlugin 能力全景

`plugin.ts` 不只是一个名字声明——它是插件的**装配入口**，可以调动整个 Host 能力面：

| 能力 | 入口 | 真实示例 |
|------|------|----------|
| 声明式能力目录 | `commands/` `tools/` `pages/` … | 无需 setup 代码，目录即能力（plugins/games/*） |
| 数据库表 + 模型 | `databaseHostToken` | lottery 定义开奖/预测表（`plugins/utils/lottery/plugin.ts`） |
| 定时任务 | `scheduleHostToken` | lottery 每日 pipeline、process-monitor 心跳 |
| 主动推送 | `outboundHostToken` | lottery 把推荐报告推到配置的目标群/私聊 |
| Agent 工具注册 | `agentToolsHostToken` | lottery 把 7 个 `lottery_*` 工具注入 AI（`agent/runtime-tools.ts`） |
| HTTP 路由 | `httpHostToken` | github 适配器注册 `/github/webhook` |
| 配置 Schema + 校验 | `schema.json` | 20 个适配器的 `endpoints` 数组 + `commandPrefix` |
| 权限/角色语义 | 配置 `master` / `trusted` | qq endpoint 管理命令仅 master 可用 |
| 实例视图与配置 | `context.plugin` / `context.config` | 多实例按 instanceKey 隔离配置 |
| 代际交接 | `context.handoff`（`activateNext`） | 等 Database 启动后再激活持久化（agent-host） |
| 卸载清理 | `context.lifecycle.add` / setup 返回 Dispose | HMR 重载时安全释放连接/定时器 |
| 硬依赖门控 | `requires: [...]` | 缺 database 直接拒绝启动（而非运行时才报错） |
| Console 展示 | `metadata.displayName/icon/order` | /api/plugins 卡片 |

::: info legacy 路径
旧的 `usePlugin()` / `plugin.yml` / `addCommand` 写法属于旧 Feature registry（`zhin dev` 路径）；新插件请使用本文的 `definePlugin` + 约定目录结构。
:::

## 下一步

- [命令系统](./commands) — `defineCommand`、文件路由参数与返回值
- [中间件与消息调度](./middleware) — `defineMiddleware` 与 Runtime Message
- [配置文件](./configuration) — `zhin.config.yml` 全量配置项
- [examples/minimal-bot](https://github.com/zhinjs/zhin/tree/main/examples/minimal-bot) — 最小可运行插件项目
- [plugins/utils/rss](https://github.com/zhinjs/zhin/tree/main/plugins/utils/rss) — schema.json + schedule + outbound 的真实插件
