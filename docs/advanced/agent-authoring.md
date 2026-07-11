# Plugin `agent/` Authoring Surface

Eve-style filesystem-first agent definitions for zhin plugins.

## Layout

```text
plugins/my-plugin/
├── agent/
│   ├── agent.ts              # defineAgent() — identity/strategy (no model, optional)
│   ├── instructions.md       # optional system prompt
│   ├── tools/*.ts            # defineTool() — path → lottery_sync
│   ├── skills/*.md           # on-demand procedures
│   ├── schedules/*.ts        # defineSchedule()
│   ├── connections/*.ts      # defineConnection() + schema; params in zhin.config
│   ├── hooks/*.ts            # AI lifecycle hooks
│   └── subagents/<name>/     # fractal child agents
└── evals/*.eval.ts           # defineEval() smoke/regression
```

## Rules

- **Path is identity**: `agent/tools/sync.ts` → runtime tool `lottery_sync` (plugin prefix `lottery_`).
- **Workspace agents**: `agents/<name>/agent.ts` + `instructions.md` (bare names for routing).
- **Model** stays in `zhin.config.yml` `ai` section, not `agent.ts`.
- **Plugin tsconfig**: `rootDir: "."`, `include: ["src/**/*", "agent/**/*"]`, `declaration: false` when shipping agent tools alongside src.
- **Optional peer**: `@zhin.js/agent` and `zod` are **optional** `peerDependencies` (IM-only installs need not install them). Monorepo builds put them in `devDependencies` only — never in `dependencies`.

## 与遗留 `skills/` 并存（框架能力）

Zhin **故意保留两条技能发现路径**，便于渐进迁移：

| 路径 | 发现器 | 扫描时机 | 典型用途 |
|------|--------|----------|----------|
| `agent/skills/*.md` + `agent/tools/*.ts` | `discoverPluginAgentSurface` → `registerPluginAgentSurfaces` | 启动 Step 1d | **推荐**：插件包新代码 |
| `skills/<name>/SKILL.md` | `discoverWorkspaceSkills` | 启动 Step 1（先于 agent/） | 工作区技能、**遗留**插件包 |

二者**可以同时存在**于工作区与未迁移的第三方插件包。本仓库官方 `plugins/` 已完成迁移并**删除**包内 `skills/`（`PERMITS.md` 迁至 `agent/PERMITS.md`）。注意：

- **同名技能**：`SkillRegistry` 按 `name` 索引，后注册者覆盖先注册者；**勿**对同一 `name` 维护两套文件。
- **工具优先级**：`agent/tools` 与程序化 `addTool` / 群管生成工具并存；`registeredAuthoringToolNames` 避免重复注册同名 authoring 工具。
- **新插件**：只维护 `agent/`；遗留 `skills/` 可在迁移完成后删除，非强制（框架仍兼容）。

工作区路径（`cwd/skills/`、`~/.zhin/skills/`、`.agents/skills/`）与插件包 `skills/` 仍由 `discoverWorkspaceSkills` 支持，与 `agent/` 无关。

## Adapter hybrid (platform tools + scene tools)

Platform adapters split responsibilities:

| Slot | Location | Registration |
|------|----------|--------------|
| Platform-specific tools (`slack_invite_to_channel`, `qq_list_guilds`, …) | `agent/tools/<slot>.ts` | `discoverPluginAgentSurface` at startup |
| Scene governance (`kick_member`, `list_members`, …) | `src/index.ts` | `createSceneManagementTools()` in `useContext('tool', …)` |

Adapter tools need runtime endpoint/adapter instances. Use **deps injection** (no `getPlugin()` in `execute`):

```ts
// src/slack-agent-deps.ts
export function setSlackAgentDeps(d: { getEndpoint: (id: string) => SlackEndpoint; getAdapter: () => SlackAdapter }) { … }

// src/index.ts — useContext('tool', 'slack', …)
setSlackAgentDeps({ getEndpoint, getAdapter: () => slack });
disposers.push(...createSceneManagementTools(slack, 'slack').map(t => toolService.addTool(t, plugin.name)));
```

Tool file slot name strips the adapter prefix: `invite_to_channel.ts` → `slack_invite_to_channel`.

## Utils migration patterns

- **Inline `addTool`**: move to `agent/tools/*.ts`, delete `plugin.addTool` / `ZhinTool` registration.
- **60s `*.tool.md`**: one `defineTool` per tool; `execute` delegates to existing `tools/<name>/handler.ts`; delete `*.tool.md`.
- **Skills**: 新代码用 `agent/skills/<name>.md`；本 monorepo 官方插件已移除包内 `skills/`（工作区 `cwd/skills/` 仍支持）。
- **PERMITS**（可选）：平台 Permit 词汇表放在 `agent/PERMITS.md`（维护者文档，**不参与** `discoverPluginAgentSurface` 自动发现）。

## Imports

```ts
import { defineAgent } from '@zhin.js/agent';
import { defineTool } from '@zhin.js/agent/tools';
import { defineSchedule } from '@zhin.js/agent/schedules';
```

## Examples

| Area | Path |
|------|------|
| Full utils pilot | [`plugins/utils/lottery/agent/`](../../../plugins/utils/lottery/agent/) |
| 60s tools (17) | [`plugins/utils/60s/agent/tools/`](../../../plugins/utils/60s/agent/tools/) |
| Adapter platform tools | [`plugins/adapters/slack/agent/tools/`](../../../plugins/adapters/slack/agent/tools/) |
| Minimal hello | [`examples/minimal-bot/src/plugins/hello/agent/`](../../../examples/minimal-bot/src/plugins/hello/agent/) |
| Workspace presets | [`examples/test-bot/agents/`](../../../examples/test-bot/agents/) |

## npm publish

带 `agent/` 的插件发布到 npm 时，发现器在生产环境读取 **`lib/agent/*.js`**（`resolveAuthoringImportPath` 优先编译产物）。发布前必须构建，且 `package.json` 的 `files` 不能漏目录。

### `package.json` 清单

| 目录 | `files` 必须包含 | 说明 |
|------|------------------|------|
| `agent/` | `agent` | 源码与 skills `.md`；开发条件 `development` 可直接读 |
| `lib/` | `lib` | `tsc` 产物，含 `lib/agent/tools/*.js` |
| `src/` | `src` | 主入口与 `*-agent-deps.ts` |
| `evals/`（若有） | `evals` | `defineEval` 冒烟/回归 |
| `tools/`（60s 等） | `tools` | 运行时 handler；`agent/tools` 动态 `import('../../tools/.../handler.js')` |

还需：

- **`prepublishOnly`: `"npm run build"`** — `npm publish` 前自动编译，避免 tarball 缺 `lib/agent/`。
- **`@zhin.js/agent` / `zod`** — 仅 `peerDependencies`（`optional: true`）+ monorepo `devDependencies`，**不要**写进 `dependencies`。

### 本地验证

```bash
pnpm --filter @zhin.js/plugin-60s build
cd plugins/utils/60s && npm pack --dry-run | rg 'agent/|lib/agent|tools/'

pnpm check:plugin-agent-publish
```

CI：`pnpm check:plugin-agent-publish`（已接入 `check:all`）。
