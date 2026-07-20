# Plugin `agent/` Authoring Surface

> 本页只描述当前实现。全新项目的目标创作面由 [ADR 0043](../adr/0043-unify-capability-roots.md) 定义为项目根或插件根下的 `commands/`、`components/`、`agents/`、`skills/`、`tools/`；目标架构不承担本页格式的兼容义务。

Eve-style filesystem-first agent definitions for zhin plugins.

## Layout

```text
plugins/my-plugin/
├── agent/
│   ├── agent.ts              # defineAgent() — identity/strategy (no model, optional)
│   ├── instructions.md       # optional system prompt
│   ├── tools/*.ts            # defineAgentTool() — path → lottery_sync
│   ├── skills/*.md           # Markdown procedures (SSOT; not TS modules)
│   ├── schedules/*.ts        # defineSchedule()
│   ├── connections/*.ts      # defineConnection() + schema; params in zhin.config
│   ├── hooks/*.ts            # defineHook() — subscribe to stream events (see below)
│   └── subagents/<name>/     # fractal child agents
└── evals/*.eval.ts           # defineEval() smoke/regression
```

## Rules

- **Path is identity**: `agent/tools/sync.ts` → runtime tool `lottery_sync` (plugin prefix `lottery_`).
- **Tools SSOT**: `agent/tools/*.ts` + `defineAgentTool`（`defineTool` from `@zhin.js/agent/tools` is a soft-deprecated alias）。
- **Skills SSOT**: `agent/skills/*.md`（Markdown）。`defineSkill` TS 仅为程序化遗留，文档不作为推荐主路径。
- **Legacy（soft-deprecate）**: `plugin.addTool` / workspace `*.tool.md` — 仍运行，新代码勿新增。
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
- **60s `*.tool.md`**: one `defineAgentTool` per tool; `execute` delegates to existing `tools/<name>/handler.ts`; delete `*.tool.md`.
- **Skills**: 新代码用 `agent/skills/<name>.md`；本 monorepo 官方插件已移除包内 `skills/`（工作区 `cwd/skills/` 仍支持）。
- **PERMITS**（可选）：平台 Permit 词汇表放在 `agent/PERMITS.md`（维护者文档，**不参与** `discoverPluginAgentSurface` 自动发现）。

## Imports

```ts
import { defineAgent } from '@zhin.js/agent';
import { defineAgentTool } from '@zhin.js/agent/tools';
import { defineSchedule } from '@zhin.js/agent/schedules';
```

## Examples

| Area | Path |
|------|------|
| Full utils pilot | [`plugins/utils/lottery/agent/`](https://github.com/zhinjs/zhin/tree/main/plugins/utils/lottery/agent) |
| 60s tools (17) | [`plugins/utils/60s/agent/tools/`](https://github.com/zhinjs/zhin/tree/main/plugins/utils/60s/agent/tools) |
| Adapter platform tools | [`plugins/adapters/slack/agent/tools/`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/slack/agent/tools) |
| Minimal agent | [`examples/minimal-bot/agents/`](../../../examples/minimal-bot/agents/) |
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

## Per-tool approval 与 toModelOutput（ADR 0039 P1）

`defineAgentTool` 支持 Eve 对齐的声明式工具策略，与 **ExecPolicy / Owner confirm 叠加**（不替代）：

```ts
import { defineAgentTool } from '@zhin.js/agent/tools';
import { always, once, never } from '@zhin.js/agent/tools';

export default defineAgentTool({
  description: '危险写操作',
  inputSchema: z.object({ path: z.string() }),
  approval: always(), // 或 once() / never() / async ({ toolName, args }) => boolean
  toModelOutput: ({ result }) => `已写入：${String(result)}`, // 模型可见摘要；IM 富消息仍走 execute 返回值
  async execute({ path }) { /* ... */ },
});
```

- **`approval`**：执行前经 `runToolApprovalGate` 发 `input.requested` / `input.completed` stream 事件，并通过内置 `ask_user` 确认。
- **`toModelOutput`**：工具原始返回值经此钩子再写入模型上下文（便于 IM 卡片与 LLM 摘要分离）。

MCP 工具名采用 **`{connection}__{tool}`**（如 `filesystem__read_file`）；`McpRegistry.listQualifiedTools()` 供发现/自省。旧 `mcp_{server}_{tool}` 仅作 legacy 解析。

## Skills 渐进披露（ADR 0039 P1）

技能**不会**在 turn 开始时全量注入 prompt。标准流程：

1. `discover(kind=skill, query=...)` — 搜索匹配技能
2. `load_skill(name)` — 按需加载完整 `instructions`
3. 调用技能解锁的工具

常量见 `@zhin.js/agent`：`SKILL_DISCLOSURE_TOOLS`、`SKILL_DISCLOSURE_STEPS`、`SKILL_DISCLOSURE_PROMPT_HINT`。

## Connection OAuth 事件（ADR 0039 P1）

交互式 connection 授权发 `authorization.required` / `authorization.completed` stream 事件。Host 完成 OAuth 后回调：

```http
POST /zhin/v1/authorization/:requestId/complete
{ "success": true, "sessionId": "ses_..." }
```

Agent 侧 `requestConnectionAuthorization` / `completeConnectionAuthorization`（`@zhin.js/agent/connection`）。

## Harness 工具禁用（ADR 0039 P2）

在 `defineAgent` 中用 Eve 风格 sentinel 声明禁用的内置/编排工具：

```ts
import { defineAgent, disableTool } from '@zhin.js/agent';

export default defineAgent({
  description: '无 shell 的子 agent',
  disallowedTools: [disableTool('bash'), disableTool('spawn_task')],
});
```

`disableTool(name)` 与字符串等价；发现时经 `normalizeToolDenylist` 写入 `AgentMeta.disallowedTools`，子 agent 工具池自动过滤。

## 维护者诊断

```bash
zhin agent info          # 人类可读
zhin agent info --json   # 机器可读
```

扫描 `plugins/**/agent/` 与 `agents/` 文件槽位（无需启动 bot）。实现：`buildAgentSurfaceInfoReport`（`@zhin.js/agent`）。Host 快照：`GET /zhin/v1/info?cwd=...`。

## defineDynamic 与 defineState（ADR 0039 P2）

**动态解析**（按 turn 调整工具池与追加 instructions）：

```ts
// agent/dynamic.ts
import { defineDynamic } from '@zhin.js/agent';

export default defineDynamic({
  async resolve({ adapter, sessionId }) {
    if (adapter === 'cron') {
      return { deniedToolNames: ['spawn_task'], additionalInstructions: 'Scheduled turn.' };
    }
  },
});
```

**会话状态**（内存 KV，按 `sessionId`；重启不持久）：

```ts
// agent/state/budget.ts
import { defineState } from '@zhin.js/agent';

export default defineState({
  initial: () => ({ spent: 0 }),
});

// 运行时（工具 execute 等）
import { getAgentState, updateAgentState } from '@zhin.js/agent';
```

## Sandbox 后端（ADR 0039 P2）

| 模式 | 配置 | 行为 |
|------|------|------|
| 进程隔离（默认） | `security/sandbox.ts` | 子进程 + ulimit + 工作目录限制 |
| Docker | `useDocker: 'auto' \| 'always' \| 'never'` | `sandbox-docker.ts`；`auto` 检测本机 Docker |
| 网络 | `network-policy.ts` | 域名 allow-list，与 ExecPolicy 叠加 |

Authoring 工具在 agent 运行时执行；需隔离时请走内置 `bash` / `read_file` 等（经 sandbox 包装），勿在 `execute` 内直接 `exec`。

## Hooks 事件词汇（ADR 0039 P0）

`defineHook({ event, handler })` 的 `event` 推荐使用与 Host NDJSON stream 一致的 **Eve 对齐词汇**（`@zhin.js/ai/agent-stream`）：

| 事件名 | 含义 |
|--------|------|
| `session.started` | 新 IM 会话或 HTTP session 开始 |
| `session.waiting` | turn 结束，等待续聊（含 `continuationToken`） |
| `turn.started` / `turn.completed` / `turn.failed` | turn 生命周期 |
| `message.received` / `message.appended` / `message.completed` | 入站与助手输出 |
| `actions.requested` / `action.result` | 工具调用与结果 |
| `reasoning.appended` | 推理文本增量 |
| `input.requested` / `input.completed` | HITL / per-tool approval |
| `authorization.required` / `authorization.completed` | Connection OAuth（Host 回调完成） |

**遗留 `type:action` 键**（`message:received`、`tool:call` 等）仍可用；触发时会自动映射到上表对应 stream 事件并通知订阅了 stream 名的 hook。

### 对外订阅：经 Plugin 总线广播（冻结契约）

插件作者应通过 **Plugin 事件总线** 订阅生命周期，而不是直接挂 HookRegistry：

| 方式 | 说明 |
|------|------|
| `onAIHook(plugin, listener)` / `plugin.on('ai.hook', …)` | 推荐 |
| `ai.session.new` / `ai.session.compact` | 会话新建 / compaction |

内部：`HookRegistry` →（StreamBus sink）→ **`emitAIHookBusEvent` → `root.dispatch('ai.hook')`**（[`plugin-ai-hook-bus.ts`](https://github.com/zhinjs/zhin/blob/main/packages/im/agent/src/plugin-ai-hook-bus.ts)）。**禁止**新增绕过 Plugin `dispatch` 的平行 hook 总线。

Hooks 为 **observe-only**（与 Eve 一致）；改 prompt / 拦截工具请用 `agent:prompt` 或 PreToolUse 策略，见 orchestrator 文档。

## 与 Eve 对照（维护者）

- 全栈差距矩阵：[eve-comparison-zh.md](./eve-comparison-zh.md)
- 架构决策（边界与分阶段路线）：[ADR 0039](../adr/0039-eve-aligned-agent-surface-roadmap.md)

## 下一 major 清扫清单（软弃用 → 硬删）

本轮仅软弃用 + harness 禁新增；计划在下一 major 删除：

- `@zhin.js/agent/tools` 的 **`defineTool` 别名**（保留 `defineAgentTool`）
- 程序化平台工具：`plugin.addTool` / `*.tool.md` 作者路径（仅保留 `agent/tools/*.ts`）
- 插件包顶层 `skills/` 发现（仅 `agent/skills/*.md` + 工作区 skills）
- 配置项 `legacyDualWrite` 与 `cron-jobs.json` 镜像写入
- 其余已 `@deprecated` 的 AI outbound/`kind`、legacy hooks 别名等（见各包 CHANGELOG）
