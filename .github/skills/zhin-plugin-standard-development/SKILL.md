---
name: zhin-plugin-standard-development
description: 'Implement Zhin.js plugins with Plugin Runtime. Use when asked to create a plugin, add commands, middleware, components, cron, AI tools/skills/agents, config, database, router, or console pages. 适用于 definePlugin / 约定目录能力落地。'
argument-hint: 'Describe the plugin goal, target package, and required capabilities (commands, middleware, events, components, cron, AI tools, config, database, router, console).'
user-invocable: true
---

# Zhin 插件标准开发姿势（Plugin Runtime）

把需求落成符合仓库约定的可运行插件。**唯一创作面是 Plugin Runtime**。

`zhin runtime start` 是唯一启动路径。插件即 package：`package.json#zhin` 声明 manifest，
`plugin.ts` **必须** default-export `definePlugin()`，否则装配抛
`does not default-export a Plugin definition`。

能力**按目录发现**（一个文件一个能力，default export），不要命令式注册：

| 目录 | API |
|------|-----|
| `commands/**/*.ts` | `defineCommand()`（路径即路由；`[name:string=default].ts` 传参） |
| `middlewares/*.ts` | `defineMiddleware()` |
| `components/*.tsx` | `defineComponent()` |
| `tools/*.ts` | `defineAgentTool()` |
| `pages/*.tsx` | `definePage()`（`$nav.tsx` / `$footer.tsx` 布局） |
| `skills/<name>/SKILL.md` | Markdown Skill |
| `agents/<name>.agent.md` | Markdown Agent |

DI：`context.resources`（Scope + Token）。清理：`context.lifecycle`。

**禁止新代码使用** `usePlugin()` / `getPlugin()` / `MessageCommand` / `addCron(new Cron)` /
`declareConfig` 经典路径——它们只在已弃用的 `zhin.js/node`（`bootstrapNode`）下有效，未接 CLI。
迁移旧代码用 [migrate-zhin-plugin-runtime](../migrate-zhin-plugin-runtime/SKILL.md)。

配套资产：

- [插件能力地图](./references/plugin-capabilities.md)
- [插件目录骨架](./references/plugin-directory-layout.md)
- [实现分支参考](./references/implementation-branches.md)
- [数据建模参考](./references/database-modeling.md)
- [最小插件骨架](./assets/minimal-plugin-template.ts)
- [模块化插件入口](./assets/modular-plugin-entry-template.ts)
- [定时任务骨架](./assets/cron-template.ts)
- [组件骨架](./assets/component-template.tsx)
- [事件与发送钩子](./assets/event-hooks-template.ts)
- [AI 工具骨架](./assets/ai-tool-template.ts)
- [模型定义骨架](./assets/model-definition-template.ts)
- [数据库服务骨架](./assets/database-service-template.ts)
- [控制台页骨架](./assets/plugin-web-entry-template.tsx)

官方指令摘要：`.github/instructions/zhin-plugin.instructions.md`。

## 何时使用

- 新建插件，或给现有 Runtime 插件加命令/中间件/组件/定时/工具/控制台页
- 接入数据库、HTTP、console
- 用户要求「按 Zhin 标准方式实现插件」

## 完成标准

- `plugin.ts` default-export `definePlugin`；`package.json#zhin` 正确
- 能力在约定目录，default export 对应 `define*` API
- 无新增 `usePlugin` / `MessageCommand` / 经典 `Plugin` 生命周期
- 相对导入带 `.js`；Host token 先 `has` 再 `use`
- 清理走 `context.lifecycle`（或 setup 返回 disposer）
- 出站不绕过统一发送链
- 做过与改动匹配的验证（test / 手测命令）

## 决策流程

### 1. 任务类型 → 目录

| 类型 | 重点 | 位置 |
|------|------|------|
| 命令 | `defineCommand`，路径即路由 | `commands/**/*.ts` |
| 中间件 / 入站过滤 | `defineMiddleware`，`target: 'inbound'` | `middlewares/*.ts` |
| 出站改写 | `target: 'outbound'` | `middlewares/*.ts` |
| 定时 | `scheduleHostToken.register` + lifecycle | `plugin.ts` 或 `agent/schedules/*.ts` |
| 组件 | `defineComponent` | `components/*.tsx` |
| AI 工具 | `defineAgentTool` | `tools/*.ts` |
| 服务 / DI | `resources.provide` | `plugin.ts` setup |
| 数据库 | `databaseHostToken`，`start` 前 `define` 表 | `plugin.ts` setup |
| Web | `definePage` | `pages/*.tsx` |

多类型并存时先定主职责，再考虑拆分子包。

### 2. 放哪一层

- Host：`packages/host/`；可选服务：`plugins/services/` / `plugins/utils/`
- 业务插件：`plugins/` 对应分类
- 示例验证：`examples/minimal-bot` / `examples/single-file-bot`
- 平台协议 → 适配器，不要写进普通插件

### 3. 依赖

Host（database / schedule / outbound / agentTools）一律可选：`has(token)` 再 `use(token)`。

- 配置：`schema.json` + `context.config.get()`
- 推送：`outboundHostToken`（不旁路发送链）
- 跨插件服务：对方 Token；必要时 `definePlugin({ requires: [...] })`

## 标准实现步骤

### 第 1 步：最小功能面

明确职责、用户入口（命令 / 中间件 / 页）、是否持久化。无复杂度时保持最小结构（可先单文件 `addCommand`，再拆 `commands/`）。

### 第 2 步：入口与骨架

- 简单：复制 [最小插件骨架](./assets/minimal-plugin-template.ts)
- 模块化：[模块化入口](./assets/modular-plugin-entry-template.ts)
- 定时 / 组件 / 钩子 / AI / DB / 页：用对应 assets

`plugin.ts` 只装配与生命周期，业务在约定目录。

### 第 3 步：命令与中间件

- 命令：路径是路由 SSOT；`execute` 读 `params` / `args` / `input`（含 session 字段若需要）
- 中间件：洋葱模型，明确是否 `await next()`
- 组件：消息渲染，不替代服务层
- AI 工具：`inputSchema` 与 execute 入参一致；副作用边界清晰

### 第 4 步：定时 / 数据库 / Web

- 定时：照抄 [cron-template](./assets/cron-template.ts)
- 数据库：先 [数据建模](./references/database-modeling.md)，再 model / service 骨架
- Web：`definePage` + 客户端与 Node 分离

结构在「单文件 vs 拆模块」间犹豫时看 [实现分支参考](./references/implementation-branches.md)。
已混乱的旧插件改用 refactoring / migrate skill，不要硬扩。

### 第 5 步：验证

1. `package.json#zhin` + default export
2. 相对导入 `.js`
3. 无 `usePlugin` / `MessageCommand` 新增
4. lifecycle / Host has-use
5. `pnpm --filter <pkg> test` 或 Sandbox 手测命令原文

## 常见分支

- **很小**：现有插件最小改动，不过度拆目录
- **多能力**：先服务端主流程，再拆数据访问与 `pages/`
- **像适配器**：停，改用 adapter 工作流

## 失败与兜底

| 触发 | 一线 | 仍失败 |
|------|------|--------|
| 命令无响应 | 查路径路由、`zhin.features` 是否含 `@zhin.js/command`、前缀配置 | 对照 minimal-bot / first-plugin 文档 |
| `does not default-export a Plugin definition` | 改成 `export default definePlugin(...)` | 查 entry 路径 |
| Host use 炸 | 先 `has(token)`；确认 Host 插件已装 | 查精简安装分档 |
| `tsc` 导入错 | 加 `.js`；查 exports | 对照官方插件 package.json |
| 控制台页 404 | 查 `definePage` / catalog 注册 | 查 Host entries API |

## 不要做什么

- 不要脚手架或新增 `usePlugin` / `MessageCommand` / `bootstrapNode`
- 不要绕过 `Message.$reply` / `Adapter.sendMessage` 发送链
- 不要把适配器协议写进普通插件
- 不要无复杂度时拆大量空目录
- 不要裸模块级单例悬挂（用 `createGenerationStore` / resources）

## 输出要求

1. 任务判断（哪类能力）
2. 方案 / 已改文件
3. 关键约束（Feature、lifecycle、config）
4. 验证结果
5. 剩余风险（仅与本次相关）
