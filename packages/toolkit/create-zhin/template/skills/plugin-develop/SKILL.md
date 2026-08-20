---
name: plugin-develop
description: "Implement Zhin.js plugin features with Plugin Runtime: defineCommand, defineAgentTool, middleware, pages. Use when asked to add a command, register a tool, wire cron, extend middleware, or build a console page. Triggers: 插件开发, add command, 加命令, 写插件功能, defineCommand."
keywords:
  - plugin
  - command
  - tool
  - cron
  - console page
  - 插件开发
  - 加命令
  - defineCommand
tags:
  - zhin
  - plugin
  - development
---

# Plugin Develop（Plugin Runtime）

在已有 Zhin 插件包内实现功能增量。能力按**约定目录发现**，一个文件一个能力；不要再写 `MessageCommand` / `usePlugin()` / `addCommand(new …)`。

## 何时使用

- 用户要在插件里「加一个命令 / 工具 / 定时任务 / 控制台页」
- 插件骨架已存在（`plugin-init` 或 `zhin new`）
- 大改目录 → 用仓库内 `zhin-plugin-standard-development` 或迁移 skill

## 工作流

### 第 1 步：定位入口与范围

1. 找到插件入口：`plugin.ts`（或单文件 bot 的 `bot.ts`）
2. 确认改动类型（只选一种主路径）：

| 能力 | 做法 | 目录 / 位置 |
|------|------|-------------|
| 聊天命令 | `defineCommand()` default export | `commands/**/*.ts`（路径即路由） |
| AI 工具 | `defineAgentTool()` | `tools/*.ts` 或 `agent/tools/*.ts` |
| 中间件 | `defineMiddleware()` | `middlewares/*.ts` |
| 组件 | `defineComponent()` | `components/*.tsx` |
| 定时任务 | `scheduleHostToken.register(...)` + `lifecycle` | `plugin.ts` setup |
| 控制台页 | `definePage()` | `pages/*.tsx` |
| 单文件 demo | `setup({ addCommand })` | 仅 `examples/single-file-bot` 风格 |

3. 确认 `package.json#zhin.features` 已挂对应 Feature（如 `@zhin.js/command`）
4. 输出：要新增/修改的文件清单

### 第 2 步：实现（禁止旧 API）

- **禁止**：`usePlugin`、`getPlugin`、`MessageCommand`、`plugin.addCommand`、`addCron(new Cron)`、`useContext('web')` 旧写法
- **命令**：文件路径是路由 SSOT；参数用 Next.js 风格文件名（`[name].ts` 必需 / `[[name]].ts` 可选 / `[...name].ts` 捕获所有），类型与默认值在 `defineCommand({ params })` 中声明；`execute` 读 `params` / `args` / `input`
- **出站**：走统一发送链（`$reply` / Adapter.sendMessage），禁止直调平台 Bot
- 本地导入带 `.js` 扩展名

**命令示例** `commands/greet/[name].ts`：

```typescript
import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  description: '问候用户',
  params: {
    name: { type: 'string', description: '用户名字' },
  },
  execute({ params }) {
    return `你好，${params.name}！`;
  },
});
```

**工具示例** `tools/get_weather.ts`：

```typescript
import { defineAgentTool } from 'zhin.js/tool';

export default defineAgentTool({
  description: '查询天气',
  inputSchema: {
    type: 'object',
    properties: { city: { type: 'string', description: '城市名' } },
    required: ['city'],
  },
  async execute({ city }) {
    return `${city}：晴，25°C`;
  },
});
```

**定时任务**（在 `plugin.ts` setup；完整骨架见仓库 skill `assets/cron-template.ts`）：

```typescript
import { definePlugin, scheduleHostToken } from 'zhin.js';

export default definePlugin({
  name: 'my-plugin',
  setup(context) {
    if (!context.resources.has(scheduleHostToken)) return;
    const schedule = context.resources.use(scheduleHostToken);
    context.lifecycle.add(
      schedule.register({
        id: 'my-plugin/hourly',
        cron: '0 * * * *',
        async execute() { /* ... */ },
      }),
    );
  },
});
```

### 第 3 步：验证

```bash
pnpm --filter <plugin-package> build   # 若包有 build
pnpm --filter <plugin-package> test
# 手测：zhin runtime start / pnpm dev + Sandbox 发命令原文
```

### 第 4 步：输出格式

```markdown
## 改动摘要
- 插件：`<package-name>`
- 类型：命令 | 工具 | cron | 中间件 | 控制台页

## 修改文件
- `commands/...` — 作用

## 验证
- `pnpm --filter <pkg> test`
- 手测：Sandbox 发 `命令原文` / 工具名

## 风险
- （仅列与本次改动相关的未测项）
```

## 文档

- `docs/authoring/define-plugin.md`
- `docs/getting-started/first-plugin.md`
- `.github/instructions/zhin-plugin.instructions.md`
