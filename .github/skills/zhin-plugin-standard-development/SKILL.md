---
name: zhin-plugin-standard-development
description: 'Implement Zhin.js plugins with the standard development workflow. Use when asked to create a plugin, add commands, middleware, event hooks, components, cron jobs, Contexts, AI tools, AI skills, AI agent presets, config schema, database, router, or web console integration, or follow the recommended Zhin plugin development pattern. 适用于 Zhin 插件标准开发姿势实现、插件功能落地、命令与 Context 接入。'
argument-hint: 'Describe the plugin goal, target package or plugin, required capabilities such as commands, middleware, events, components, cron, Context, AI tools, AI skills, AI agent presets, config, database, router, or web console integration.'
user-invocable: true
---

# Zhin 插件标准开发姿势

把 Zhin.js 插件需求转成符合仓库约定的可运行实现，避免常见的插件结构混乱、生命周期不稳、Context 使用错误和命令设计失衡。

> **⚠️ 当前架构以 Plugin Runtime 为准（本文正文尚未完全迁移）**
>
> `zhin runtime start` 是唯一启动路径。插件即 package：`package.json#zhin` 声明 manifest，
> `plugin.ts` **必须 default export `definePlugin()`**，否则装配阶段直接抛
> `does not default-export a Plugin definition`。
>
> 能力**按目录发现**（一个文件一个能力，default export），不再命令式注册：
> `commands/**/*.ts`（`defineCommand`）、`middlewares/*.ts`（`defineMiddleware`）、
> `components/*.tsx`（`defineComponent`）、`tools/*.ts`（`defineAgentTool`）、
> `pages/*.tsx`（`definePage`）、`agent/skills/*.md`、`agents/*.agent.md`。
> 依赖注入使用 Scope + Token（`context.resources`），生命周期用 `context.lifecycle`。
>
> 下面**正文与部分表格仍在描述旧的 `usePlugin()` / `addCommand()` 写法**，那套 API 只在
> `zhin.js/node`（`bootstrapNode`）下有效，且未接任何 CLI 命令；在 `zhin runtime start`
> 下不工作。以 **assets/ 骨架**（已迁移）与
> [迁移映射](../migrate-zhin-plugin-runtime/references/migration-map.md) 为准。

配套资产按需加载：

- [插件能力地图](./references/plugin-capabilities.md)
- [插件目录骨架参考](./references/plugin-directory-layout.md)
- [实现分支参考](./references/implementation-branches.md)
- [数据建模参考](./references/database-modeling.md)
- [最小插件骨架](./assets/minimal-plugin-template.ts)
- [模块化插件入口骨架](./assets/modular-plugin-entry-template.ts)
- [定时任务骨架](./assets/cron-template.ts)
- [组件骨架](./assets/component-template.tsx)
- [事件与发送钩子骨架](./assets/event-hooks-template.ts)
- [AI 工具骨架](./assets/ai-tool-template.ts)
- [模型定义骨架](./assets/model-definition-template.ts)
- [数据库服务骨架](./assets/database-service-template.ts)
- [控制台前端入口骨架](./assets/plugin-web-entry-template.tsx)

## 何时使用

- 新建一个 Zhin 插件
- 给现有插件增加命令、中间件、事件监听、组件、定时任务或 Context
- 接入数据库、HTTP router、console web 页面
- 暴露 AI 工具或在发送链上做统一改写
- 重构插件入口、服务拆分、Schema 组织方式
- 用户明确要求“按 Zhin 标准方式实现插件”或“按标准姿势开发”

## 完成标准

- 插件结构与职责清晰，符合当前仓库布局
- 正确使用 `usePlugin()`、`provide()`、`useContext()`、`inject()`、`declareConfig()`
- 命令、中间件、事件、组件、定时任务、Context 生命周期行为一致
- TypeScript 导入路径遵守 `.js` 扩展名约定
- 如果涉及数据库、HTTP、Web 集成，接入方式与仓库现有模式一致
- 需要 `addCron()`、`addComponent()` 等扩展时，确认对应核心服务已启用
- 至少完成与改动匹配的验证：类型检查、测试、构建或关键路径检查

## 决策流程

### 1. 先判断插件任务类型

根据用户目标决定实现重点：

| 类型 | 重点 | 入口（能力目录，default export） |
|------|------|----------|
| 命令型插件 | `defineCommand()`、文件路径即路由、`[name:string=default].ts` 传参 | `commands/**/*.ts` |
| 中间件型插件 | `defineMiddleware()`、`target: 'inbound'`、消息过滤 | `middlewares/*.ts` |
| 事件型插件 | 入站用 `target: 'inbound'`；发送前改写用 `target: 'outbound'` | `middlewares/*.ts` |
| 定时型插件 | `scheduleHostToken.register()`（登记 disposer） | `plugin.ts` setup 或 `agent/schedules/*.ts` |
| 组件型插件 | `defineComponent()`、文件名即组件名 | `components/*.tsx` |
| AI 工具型插件 | `defineAgentTool()`、`inputSchema` 与入参一致 | `tools/*.ts` 或 `agent/tools/*.ts` |
| 服务型插件 | `context.resources.provide(token, value)`、`context.lifecycle` | `plugin.ts` setup |
| 数据型插件 | `databaseHostToken`：`start()` 前 `define()` 表 | `plugin.ts` setup |
| Web 集成插件 | `definePage()`、`$nav.tsx` / `$footer.tsx` | `pages/*.tsx` |

如果一个插件同时包含多种类型，优先梳理主职责，再决定是否拆分子模块。

### 2. 确认放在哪一层

- 内置 Host 服务见 `packages/host/`；可选第三方服务放 `plugins/services/` 或 `plugins/utils/`
- 平台无关的业务插件放在 `plugins/` 下对应分类
- 仅示例或开发验证用途，放在 `examples/test-bot` 或示例项目里
- 不要把平台适配逻辑写进普通插件，适配器问题交给 adapter 层

### 3. 确认依赖与上下文

实现前先判断需要哪些上下文和依赖：

Host 资源（database / schedule / outbound / agentTools 等）都是**可选**的：
一律先 `context.resources.has(token)` 再 `use(token)`，否则精简安装下会装配失败。

- 需要配置：字段写进 `schema.json`，在 setup 里 `context.config.get()` 读取
- 需要数据库：`databaseHostToken`，`start()` 之前 `db.define(...)` 建表
- 需要定时任务：`scheduleHostToken.register({ id, cron, execute })`，并把 disposer 交给 `context.lifecycle`
- 需要主动推送：`outboundHostToken.send(...)`（不要绕过发送链路）
- 需要组件：`components/*.tsx` + `defineComponent()`
- 需要事件监听 / 发送前改写：`middlewares/*.ts`，选 `target: 'inbound' | 'outbound'`
- 需要 AI 工具：`tools/*.ts` + `defineAgentTool()`；AI 可选时用 `agentToolsHostToken` 守卫并懒加载
- 需要其他插件的服务：用对方导出的 Token，必要时写进 `definePlugin({ requires: [...] })`
- 所有清理：`context.lifecycle.add(dispose)` 或从 `setup()` 返回 disposer

如果依赖不是插件启动时必需，不要在模块顶层直接强行读取未就绪 Context。

## 标准实现步骤

### 第 1 步：界定最小功能面

先明确：

- 插件核心职责是什么
- 用户入口是命令、事件、中间件还是 Web 页面
- 是否需要持久化和外部依赖
- 是否需要拆出 `commands/`、`services/`、`client/` 子目录

如果你不确定目录应该长什么样，先看 [插件目录骨架参考](./references/plugin-directory-layout.md)。

避免一开始就铺开过多文件。没有明显复杂度之前，先保持最小结构。

### 第 2 步：建立插件入口

入口模块应负责：

- 获取 `usePlugin()`
- 注册配置或读取配置
- 装配命令、中间件、Context 和子模块
- 保持生命周期清晰，不在入口里塞满业务实现

优先模式：

1. 简单插件：单文件入口直接实现
2. 中等插件：入口负责装配，业务逻辑拆到 `commands/`、`services/`
3. 含前端插件：服务端入口 + `client/` 前端入口分离

目录拆分不确定时，用 [插件目录骨架参考](./references/plugin-directory-layout.md) 选择最接近的结构。

如果需要从骨架开始，优先参考：

- 简单插件用 [最小插件骨架](./assets/minimal-plugin-template.ts)
- 模块化插件用 [模块化插件入口骨架](./assets/modular-plugin-entry-template.ts)
- 定时任务用 [定时任务骨架](./assets/cron-template.ts)
- 组件用 [组件骨架](./assets/component-template.tsx)
- 事件监听或发送前改写用 [事件与发送钩子骨架](./assets/event-hooks-template.ts)
- AI 工具用 [AI 工具骨架](./assets/ai-tool-template.ts)
- 带控制台页面的插件再配合 [控制台前端入口骨架](./assets/plugin-web-entry-template.tsx)

### 第 3 步：实现 Context 和服务

使用 `provide()` 时：

- `value` 适合纯同步值
- `mounted` 适合需要异步初始化的服务
- 资源型 Context 必须配套 `dispose` 或通过 `useContext()` 返回清理函数

使用 `useContext()` 时：

- 在依赖就绪后再注册命令、路由或定时任务
- 多个依赖一起用时，在一个回调中统一装配
- 如果注册了监听器、定时器、路由或动态入口，返回清理函数

### 第 4 步：实现命令与中间件

命令实现要求：

- 使用 `MessageCommand`
- 参数从 `result.params` 读取
- 模板语法写全类型，如 `<name:text>`、`[count:number=1]`
- 根据需要添加描述、示例、别名或权限约束

中间件实现要求：

- 遵守洋葱模型，明确是否调用 `await next()`
- 做过滤时要明确是拦截还是放行
- 不在中间件中混入过多与消息链无关的业务状态

事件实现要求：

- 根据语义选择 `message.receive`、`message.private.receive`、`message.group.receive`
- 发送前改写或审计优先使用 `before.sendMessage`
- 事件监听器涉及外部资源时，配套 `onDispose()` 或清理函数

组件实现要求：

- 需要可复用消息片段或异步渲染时使用 `defineComponent()` / `addComponent()`
- 组件名和职责保持聚焦，不把整段业务流程塞进组件渲染
- 组件更多是消息渲染能力，不替代服务层或命令层

AI 工具实现要求：

- 面向 AI 可调用能力时，用 `plugin.addTool()` 或 `plugin.addToolOnly()`
- 工具参数、权限边界和副作用要清晰
- 如果工具只是 AI 能力，不要顺带生成面向普通聊天的命令入口

### 第 5 步：接入定时任务、数据库或 Web 能力

定时任务相关：

- 使用 `addCron(new Cron(expression, callback))`
- Cron 会在注册后自动启动，插件卸载时自动停止
- 周期配置优先通过 `declareConfig()` 暴露，不要把表达式硬编码到多处
- 需要按条件启停时，保留 dispose 或索引能力

参考起步资产：

- [定时任务骨架](./assets/cron-template.ts)

数据库相关：

- 模型定义与使用方式保持仓库约定
- 在 `database` Context 就绪后执行依赖数据库的装配逻辑
- 避免在命令里直接堆砌大量查询细节，必要时抽服务层

建议顺序：

1. 先看 [数据建模参考](./references/database-modeling.md)
2. 再从 [模型定义骨架](./assets/model-definition-template.ts) 起步
3. 最后用 [数据库服务骨架](./assets/database-service-template.ts) 把命令或服务挂到 `database` Context 上

Web 相关：

- HTTP 路由通过 `router` Context 注册
- 控制台页面通过 `web.addEntry()` 挂载客户端入口
- 前端页面与服务端逻辑分离，避免把页面状态塞进插件入口

常用起步资产：

- 数据库装配参考 [数据库服务骨架](./assets/database-service-template.ts)
- 客户端页面参考 [控制台前端入口骨架](./assets/plugin-web-entry-template.tsx)

如果任务在“单文件实现”与“拆模块”之间不明确，先看 [实现分支参考](./references/implementation-branches.md) 再决定结构。

如果你不确定某种能力是否该由插件承担，先看 [插件能力地图](./references/plugin-capabilities.md) 再决定结构。

如果你面对的是一个已经存在但结构混乱的插件，不要继续用本 skill 硬改，改用 `zhin-plugin-refactoring` skill。

如果你只是想快速发起一次标准插件实现，也可以直接用 prompt：`/zhin-create-plugin`。

### 第 6 步：收尾与验证

至少检查以下内容：

1. 导入路径是否使用 `.js`
2. `usePlugin()` 是否在合适作用域调用
3. Context 是否有正确的挂载与清理
4. 配置是否使用 `declareConfig()` 并与默认值一致
5. 命令参数模板和 `result.params` 使用是否正确
6. 定时任务、事件监听、组件、Web 入口是否具备清理路径
7. 改动是否需要运行测试、构建或局部验证

## 常见分支判断

### 需求很小

如果只是新增一个简单命令或小型中间件：

- 优先在现有插件中最小改动
- 不为“整洁”过度拆文件

### 需求跨多个能力

如果同时有命令、数据库、Web 页面：

- 先确定服务端主流程
- 再把数据访问与前端入口拆开
- 避免在一个文件里同时处理命令、路由、页面和数据库细节

### 需求像适配器而不是插件

如果用户要处理平台协议、Endpoint 生命周期、消息格式转换、发送/撤回：

- 不按本 skill 继续
- 改用 `adapter-developer` agent 或适配器相关工作流

## 失败与兜底

| 触发条件 | 一线处理 | 仍失败 |
|----------|----------|--------|
| `useContext` 永不执行 | 核对依赖插件是否在 `zhin.config` 的 `plugins` 列表 | 查启动日志 Context `provided` 顺序 |
| 命令注册无响应 | 核对 `MessageCommand` 模板与 `result.params` | 对照 [实现分支参考](./references/implementation-branches.md) |
| `tsc` 导入报错 | 互导路径加 `.js`；检查 `exports.development` | 对照官方插件 `package.json` |
| 控制台页 404 | 确认 Console catalog page 注册时机（Host 由 CLI 装配） | 查 `GET /entries` 是否列出 entry |
| 结构已混乱难下手 | 停止扩写本 skill | 改用 `zhin-plugin-refactoring` |

## 🔴 CHECKPOINT · 大范围改动前

同时涉及数据库 + HTTP + `client/` 或改动超过 3 个模块前，向用户确认：功能列表、目录拆分、是否配套测试。

## 不要做什么

- 不要在 `async` 回调里调用 `usePlugin()`
- 不要从 `@zhin.js/core` 直接 import（用户项目统一 `zhin.js`）
- 不要绕过 `Message.$reply` / `Adapter.sendMessage` 发送链
- 不要把适配器协议写进普通插件
- 不要为「整洁」在无复杂度时拆出大量空目录

## 输出要求

最终输出应包含：

1. 插件任务判断：要实现的是哪类插件能力
2. 实现方案：准备怎么组织或已经改了什么
3. 关键约束：依赖、生命周期、配置、命令或 Context 注意点
4. 验证结果：做了哪些检查，哪些未验证
5. 剩余风险：仅保留与当前改动直接相关的风险

## Zhin 特有注意事项

- `usePlugin()` 优先在模块顶层调用，避免异步边界丢失上下文
- TypeScript 源码导入路径使用 `.js` 扩展名
- 类型扩展使用 `declare module 'zhin.js'`
- 配置声明优先使用 `declareConfig()`，这是源码里的真实主路径
- 资源注册后要有对应清理，尤其是监听器、定时器、Web 入口、路由
- `before.sendMessage` 是统一出站切点，适合做发送前审计、过滤和改写
- `addCron()`、`addComponent()` 等扩展依赖对应核心服务启用
- 不要绕开插件系统直接拼装与现有生命周期不一致的初始化逻辑