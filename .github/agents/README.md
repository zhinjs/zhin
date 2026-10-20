# Zhin.js GitHub Copilot Agents

这些 Agent 是仓库开发入口的角色化路由。根 `AGENTS.md` 是共同约束；插件能力的权威说明是
`.github/instructions/zhin-plugin.instructions.md`，具体任务再加载对应 Skill。

| Agent | 适用范围 | 首选资料 |
| --- | --- | --- |
| `zhin` | 跨包框架实现与集成 | `docs/concepts/architecture.md` |
| `plugin-developer` | Plugin Runtime 包与能力目录 | `zhin-plugin-standard-development` / `migrate-zhin-plugin-runtime` |
| `adapter-developer` | 平台 Client、事件、Endpoint 与传输 | `docs/authoring/adapters.md` / `docs/authoring/endpoint-lifecycle.md` |
| `Zhin Architecture Optimizer` | 分层、依赖方向、运行时边界 | `zhin-audit` |
| `Zhin Plugin Optimizer` | 已有插件结构与生命周期 | `zhin-plugin-refactoring` |
| `Zhin Frontend Optimizer` | Console 和插件页面 | `docs/console/index.md` |

## 当前创作契约

- `plugin.ts` default-export `definePlugin()`，只负责 Resource 与生命周期装配。
- 代码能力使用命名目录与固定入口，例如 `commands/**/index.ts`、
  `tools/<name>/index.ts`、`schedules/<name>/index.ts`。
- Skill 使用 `skills/<name>/SKILL.md`；具名 Agent 使用
  `agents/<name>/agent.json` 加 `system.md`、`boundaries.md`、`conventions.md`。
- Tool 的审批字段是 `requiresApproval`；平台、场景和身份限制分别使用
  `platforms`、`scopes`、`permissions`。
- 普通 Adapter default-export `defineAdapter()`，优先返回
  `{ client, connect, activate?, send }`；长连接状态机使用 `createEndpointLifecycle`。
- 配置由 `schema.json` 声明；setup 使用 `context.resources`，能力回调使用
  `context.use(token)`。代级状态不得放入模块级可变单例。

## 验证

先运行改动包的 build/test。涉及能力创作面时，再运行对应门禁：

```bash
pnpm check:agent-tool-authoring-boundaries
pnpm check:skill-authoring-boundaries
pnpm check:agent-authoring-boundaries
pnpm check:hook-authoring-boundaries
pnpm check:plugin-capability-publish
```

不要从本目录复制旧式模板。可运行示例以 `examples/minimal-bot`、
`examples/full-bot` 和当前平台适配器源码为准。
