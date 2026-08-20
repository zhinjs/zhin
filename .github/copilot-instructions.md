# Zhin.js Copilot Instructions

优先阅读根目录 `AGENTS.md`。它是仓库级入口。

> **Plugin Runtime 为准。** 新插件只用 `definePlugin` + 约定目录（`defineCommand` 等）。  
> **禁止**教 / 写 `usePlugin()`、`MessageCommand`、`bootstrapNode` / `zhin.js/node`。  
> 插件创作面：`.github/instructions/zhin-plugin.instructions.md`  
> 标准流程：skill `zhin-plugin-standard-development`  
> 迁移旧代码：skill `migrate-zhin-plugin-runtime`

## 常驻约束

- pnpm workspace monorepo，不用 git submodule。
- TypeScript 本地相对导入必须带 `.js` 扩展名。
- 新插件：`plugin.ts` default-export `definePlugin()`；能力按目录发现。
- IM 出站：`Message.$reply` / `Adapter.sendMessage` → `renderSendMessage` → `before.sendMessage` → Endpoint；禁止旁路。
- 分层：`basic → kernel → ai → core → agent → zhin`（`basic/cli` 可为 composition root）。
- 改架构前读 `docs/concepts/architecture.md`、`docs/contributing/repo-structure.md`。

## 最小创作面示例

```typescript
// plugin.ts
import { definePlugin } from 'zhin.js';

export default definePlugin({
  name: 'my-plugin',
  metadata: { displayName: 'My Plugin' },
  setup(context) {
    context.lifecycle.add(() => { /* cleanup */ });
  },
});
```

```typescript
// commands/hello/[name].ts — 路径即路由，类型在 params 中声明
import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  description: '打招呼',
  params: {
    name: { type: 'string', description: '名字' },
  },
  execute({ params }) {
    return `你好，${params.name}！`;
  },
});
```

单文件 demo：`examples/single-file-bot/bot.ts`（`setup({ addCommand })`）。

## 约定目录

| 目录 | API |
|------|-----|
| `commands/**/*.ts` | `defineCommand()` |
| `middlewares/*.ts` | `defineMiddleware()` |
| `components/*.tsx` | `defineComponent()` |
| `tools/*.ts` | `defineAgentTool()` |
| `pages/*.tsx` | `definePage()` |
| `skills/<name>/SKILL.md` | Skill |
| `agents/<name>.agent.md` | Agent |

`package.json#zhin` 声明 `entry` / `features`。详情见 instructions 文件。

## 开发工作流

```bash
pnpm build                    # turbo：basic → packages → plugins
pnpm --filter @zhin.js/core build
pnpm test / pnpm test:watch / pnpm test:coverage
pnpm dev                      # examples/minimal-bot（Stable）
pnpm dev:full                 # examples/full-bot（L4）
pnpm release / pnpm bump / pnpm pub   # changesets
```

测试：Vitest globals、`**/*.test.ts`。覆盖率阈值见根 `vitest.config.ts`。

## Host / 资源

- Host 由 CLI 装配；插件侧 `context.resources.has(token)` 再 `use(token)`。
- 定时：`scheduleHostToken.register` + `context.lifecycle.add(dispose)`（见 skill assets/cron-template）。
- 配置：插件自有字段写 `schema.json`，`context.config.get()` 读取。
- 模块级状态：优先 `createGenerationStore`（`zhin.js`）。

## 适配器要点

- `$sendMessage` 返回消息 ID；`$formatMessage` 的 Message 含 `$recall`。
- 入站事件：`message.receive` / `message.private.receive` / `message.group.receive`。
- 新适配器：`defineAdapter` + 约定目录；不要 `extends Adapter` / `usePlugin`。

## JSX

IM 消息组件：`jsxImportSource: "zhin.js"`。Satori 出图卡片在文件顶加 `/** @jsxImportSource @zhin.js/satori */`。

## 已弃用（勿在新代码使用）

| API | 替代 |
|-----|------|
| `usePlugin` / `getPlugin` / `MessageCommand` | `definePlugin` / `defineCommand` |
| `bootstrapNode` / `zhin.js/node` | `zhin runtime start` |
| `addCron(new Cron)` / 经典 `useContext` | `scheduleHostToken` / `context.resources` |
| `examples/test-bot` 当作用户模板 | `minimal-bot` → `full-bot` |

清单 SSOT：`docs/contributing/public-api-surface.md`。

## 参考

- `AGENTS.md`、`CLAUDE.md`
- `docs/getting-started/first-plugin.md`、`docs/authoring/define-plugin.md`
- `.github/skills/zhin-plugin-standard-development/`
- `.github/skills/migrate-zhin-plugin-runtime/`
