---
name: plugin-develop
description: "Implement Zhin.js plugin features: commands, AI tools, cron jobs, middleware, and console pages. Use when asked to add a command, register a tool, wire cron, extend middleware, or build a console page entry. Triggers: 插件开发, add command, addTool, 加命令, 写插件功能."
keywords:
  - plugin
  - command
  - tool
  - cron
  - console page
  - 插件开发
  - 加命令
tags:
  - zhin
  - plugin
  - development
---

# Plugin Develop

在已有 Zhin 插件包内实现功能增量（命令、工具、定时任务、中间件、控制台页），不重写整个插件结构。

## 何时使用

- 用户要在插件里「加一个命令 / 工具 / 定时任务 / 控制台页」
- 插件骨架已存在（`plugin-init` 或 `zhin new` 已跑过）
- 需要大改目录或拆模块 → 改用 `zhin-plugin-refactoring` 或仓库内 `zhin-plugin-standard-development`

## 工作流

### 第 1 步：定位入口与范围

1. 找到插件入口：`plugins/<name>/src/index.ts` 或项目内 `src/plugins/<name>/`
2. 确认改动类型（只选一种主路径，其余作附带）：
   - 命令 → `MessageCommand` + `addCommand`
   - AI 工具 → `plugin.addTool()` / `addToolOnly()`
   - 定时任务 → `addCron(new Cron(...))`
   - 中间件 → `addMiddleware()`
   - 控制台页 → `useContext('web', ...)` + `client/`
3. 输入：用户需求、目标插件名、平台约束（如有）
4. 输出：明确的文件清单（要改哪些 `src/` / `client/` 文件）

### 第 2 步：选最小 API 实现

| 能力 | API | 前置条件 |
|------|-----|----------|
| 聊天命令 | `addCommand(new MessageCommand('...').action(...))` | `command` 服务 |
| AI 工具 | `plugin.addTool({ name, execute, ... })` | Agent 已启用 |
| 定时任务 | `addCron(new Cron(expr, fn))` | `cron` 服务 |
| 消息过滤 | `addMiddleware(fn)` | 无 |
| HTTP 路由 | `useContext('router', ...)` | `@zhin.js/host-router` |
| 控制台页 | `useContext('web', ...)` + `web.addEntry()` | `@zhin.js/host-api` |

- `usePlugin()` 仅在模块顶层调用
- TS 本地导入使用 `.js` 扩展名
- 平台差异放在 adapter 检查或 tool `description`，不要写进通用 SKILL 正文

### 第 3 步：装配与清理

- `useContext()` 注册监听器、定时器、路由时，回调**必须返回清理函数**
- 业务逻辑放在 `commands/`、`services/`、`tools/`，入口只做装配
- 出站消息必须走 `Message.$reply` / `Adapter.sendMessage` 链，禁止直调平台 Bot

### 第 4 步：验证

```bash
pnpm --filter <plugin-package> build
pnpm --filter <plugin-package> test
# 可选：在 examples/minimal-bot 或用户项目 pnpm dev + Sandbox 手测命令
```

报告：改了哪些文件、如何触发验证（命令文本 / 工具名 / 访问路径）。

### 第 5 步：输出格式（必须包含）

```markdown
## 改动摘要
- 插件：`<package-name>`
- 类型：命令 | 工具 | cron | 中间件 | 控制台页

## 修改文件
- `src/...` — 作用

## 验证
- 命令：`pnpm --filter <pkg> build && pnpm --filter <pkg> test`
- 手测：Sandbox 发 `命令原文` / 工具名 `tool_name`

## 风险
- （仅列与本次改动相关的未测项）
```

## 代码片段（按需复制改）

**命令**（`src/commands/greet.ts` 或入口）：

```typescript
import { MessageCommand } from 'zhin.js'

plugin.addCommand(
  new MessageCommand('greet <name:text>')
    .desc('问候用户')
    .action(async (_message, result) => `Hello, ${result.params.name}!`),
)
```

**AI 工具**：

```typescript
plugin.addTool({
  name: 'my_tool',
  description: '一句话说明副作用与输入',
  parameters: {
    type: 'object',
    properties: { q: { type: 'string', description: '查询词' } },
    required: ['q'],
  },
  execute: async ({ q }) => { /* 返回 string 或可序列化对象 */ },
})
```

**定时任务**（需 `cron` 服务）：

```typescript
import { Cron } from 'zhin.js'

plugin.addCron(
  new Cron('0 9 * * *', async () => {
    plugin.logger.info('daily job')
  }),
)
```

**useContext 清理**：

```typescript
useContext('database', (db) => {
  const timer = setInterval(() => {}, 60_000)
  return () => clearInterval(timer)
})
```

## 失败与兜底

| 触发条件 | 一线处理 | 仍失败 |
|----------|----------|--------|
| `useContext` 回调不执行 | 确认依赖 Context 的插件已 `start()`；检查 `plugins` 列表是否包含 host-router/host-api | 查启动日志里 Context `provided` 顺序 |
| `addCron` 无效果 | 确认配置里启用了 `cron` 服务 | 在入口临时 `logger.info` 验证 Cron 是否注册 |
| 命令不匹配 | 检查 `MessageCommand` 模板与 `result.params` 类型 | 用 `tests/commands.test.ts` 单独测 action |
| `tsc` 报导入错误 | 互导路径加 `.js`；`exports.development` 指向 `src/` | 对照同仓库官方插件 `package.json` |
| 控制台页 404 | 确认 `@zhin.js/host-api` 已加载且 `web.addEntry` 在 `web` Context 就绪后调用 | 查 `/entries` 是否列出该 entry |

## 🔴 CHECKPOINT · 范围确认

在改超过 3 个文件或涉及数据库/HTTP/控制台之前，向用户确认：功能列表、是否接受拆 `commands/` / `services/`、是否需配套测试。

## 不要做什么

- 不要在 `async` 函数或回调里调用 `usePlugin()`
- 不要从 `@zhin.js/core` 直接 import 框架 API（用户项目用 `zhin.js`）
- 不要把适配器协议、Endpoint 生命周期写进普通插件（交给 adapter 层）
- 不要绕过发送链 `renderSendMessage → before.sendMessage → 平台发送`
- 不要为「整洁」一次性拆出大量空目录；无复杂度时保持单文件

## 延伸阅读

| 文档 | 路径 |
|------|------|
| 工具与技能 | `docs/advanced/tools-skills.md` |
| 插件规范 | `.github/instructions/zhin-plugin.instructions.md` |
| Monorepo 深度开发 | `.github/skills/zhin-plugin-standard-development/SKILL.md` |
| 最小可跑示例 | `examples/minimal-bot/` |
