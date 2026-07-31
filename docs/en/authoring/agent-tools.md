---
title: Agent Tools and Skills
description: tools/*.ts convention and setup dynamic registration — two paths, canAccessTool unified access control, deferred catalog and load_tool, skills and *.agent.md
---

# Agent Tools and Skills

Want the model to search a song or check a lottery recommendation for the user? Write that logic into a file, drop it in `tools/`, and the model can call it by name on the next Agent turn. There are two registration paths: **`tools/*.ts` file convention** (declarative, inherited along the plugin tree) and **`setup()` dynamic registration** (imperative, mounted per generation). Both paths share the same access predicate and the same deferred catalog.

```mermaid
flowchart LR
    A["tools/*.ts<br/>defineAgentTool"] --> C[ToolIndex projection]
    B["setup() → agentToolsHostToken<br/>host.register()"] --> D[AgentToolsHost registry]
    C --> E[CapabilityIngress]
    D --> E
    E --> F{"canAccessTool(message)<br/>platforms/scopes/permissions"}
    F -->|hidden filtering| G[deferred catalog]
    G --> H["discover / load_tool / load_skill"]
    H --> I[Tool set callable by the model]
```

## Path One: `tools/*.ts` Convention

After mounting the `@zhin.js/tool` Feature, each `.ts` file under `tools/` (non-recursive) in the plugin package root default-exports `defineAgentTool(...)`:

```ts
// tools/echo.ts (examples/minimal-bot)
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ message: string }>({
  description: 'Echo a message back',
  inputSchema: z.object({ message: z.string().min(1) }),
  async execute({ message }) {
    return `echo: ${message}`;
  },
});
```

Definition fields (`packages/im/tool/src/definition.ts`):

| Field | Required | Description |
| --- | --- | --- |
| `description` | Yes | Functional description for the model |
| `inputSchema` | No | zod object or JSON Schema, drives parameter validation and catalog display |
| `approval` | No | `'never' \| 'on-risk' \| 'always'`, default `'on-risk'` |
| `platforms` | No | Restrict to adapter platforms (e.g., `['icqq']`), empty = all |
| `scopes` | No | Restrict to session scenes `'private' \| 'group' \| 'channel'`, empty = all |
| `permissions` | No | Permit string list (see access control below) |
| `hidden` | No | Registered but not exposed to the model (callable by name only) |
| `execute(input, context)` | Yes | `context` is the capability context (`config` / `use(token)` / `owner` / `generation`) |

The tool name is the file name -- this is the name exposed to the model; note it must be unique across plugins. Child plugins can see and override parent plugins' same-named tools (resolved upward along the plugin tree). The descriptor also has `qualifiedName` (owner path segments and file name joined with `__`) for disambiguation.

## Path Two: setup Dynamic Registration

When you need to decide which tools to register based on runtime conditions (configuration switches, database handles), get `AgentToolsHost` via `agentToolsHostToken` (exported from `@zhin.js/plugin-runtime`) inside `setup()`:

```ts
// plugins/utils/lottery/plugin.ts (excerpt)
import { definePlugin, agentToolsHostToken } from '@zhin.js/plugin-runtime';

export default definePlugin({
  name: 'lottery',
  async setup(context) {
    // When AI is not installed/enabled, the Host doesn't exist -- must guard with has() first
    if (context.resources.has(agentToolsHostToken)) {
      const agentTools = context.resources.use(agentToolsHostToken);
      const { registerLotteryAgentTools } = await import('./agent/runtime-tools.js');
      context.lifecycle.add(registerLotteryAgentTools(agentTools));
    }
  },
});
```

`host.register(tool)` registers under the **current generation** and returns an unregister function; hooking it to `context.lifecycle` enables automatic cleanup with generation turnover. Registration item (`AgentToolRegistration`):

```ts
host.register({
  name: 'lottery_sync',          // Runtime name exposed to the model
  description: tool.description,
  inputSchema: tool.inputSchema, // zod object or JSON Schema
  source: 'lottery',             // Source label (for diagnostics)
  platforms: tool.platforms,     // Same four-tuple as path one
  scopes: tool.scopes,
  permissions: tool.permissions,
  hidden: tool.hidden,
  approval: 'never',             // 'never' | 'always', combined with ExecPolicy
  execute: (input) => tool.execute(input, { pluginName: 'lottery', runtimeName: name }),
});
```

Note: the `execute` closure captures dependencies at `setup()` time. **Do not call plugin locators** (such as `getPlugin()`) **inside the closure** -- the runtime path prohibits dynamic plugin retrieval.

## Unified Access Control: canAccessTool

Tools registered via both paths are filtered by Core's `canAccessTool(tool, message)` against the message context on every Agent turn -- **one predicate governs both paths** (`packages/im/core/src/built/tool.ts`; on the Plugin Runtime side, it's applied through `CapabilityIngress`, see `packages/im/agent/src/plugin-runtime/capability-ingress.ts`).

Four-tuple semantics:

| Field | Determination |
| --- | --- |
| `platforms` | Reject if the message's source adapter name (`String(message.$adapter)`) is not in the list |
| `scopes` | Reject if the session scene (`message.$channel.type`, default `private`) is not in the list |
| `permissions` | Permit list, checked item by item (AND); commas inside parentheses mean OR |
| `hidden` | Not included in the tool list given to the model, but still executable by name |

Permit syntax (`packages/im/core/src/built/permit-parse.ts`) has three categories: built-in `adapter(name)`, `group(id,...)`, `private(id,...)`, `channel(id,...)`, `user(id,...)`, `role(master|trusted|user)`; platform identity `platform(adapter,perm)` (e.g., group owner/admin, determined by adapter checker); unrecognized permits are always rejected.

## Deferred Catalog and load_tool

Tools are not included in the full prompt. Each turn first builds a **catalog** of tools that pass access control; by default only `alwaysLoadedTools` are exposed to the model. Remaining tools are discovered and loaded on demand via three meta-tools (`packages/im/agent/src/builtin/deferred-tool-meta.ts`): `discover` searches tools/skills by query (can filter by MCP server), returning names with brief descriptions; `load_tool` loads a tool's schema into the session by name, making it callable; `load_skill` loads the complete skill instructions and unlocks its associated tools.

Loading state is persisted per session (`DeferredToolSessionSnapshot`), with an eviction limit. Configuration key `deferredTools` (`ZhinAgentConfig`):

| Key | Default | Description |
| --- | --- | --- |
| `maxLoadedPerSession` | `12` | Maximum number of tools loaded per session |
| `discoverTopK` | `5` | Number of results returned by `discover` |
| `alwaysLoadedTools` | `['ask_user', 'spawn_task', 'discover', 'load_tool', 'load_skill']` | Always visible to the model |
| `mcpServers` | `{}` | Override `alwaysLoaded` list per MCP server |

The Anthropic SDK channel marks unloaded tools with `deferLoading`; other channels only deliver the loaded set.

## skills and agents/*.agent.md

Skills and named Agents are also file conventions, discovered by the `@zhin.js/skill` and `@zhin.js/agent-feature` Features respectively.

Skills go in `skills/<name>/SKILL.md` (one skill per subdirectory): the body is the instruction for the model, the first Markdown heading line serves as the description, and `load_skill` unlocks tools associated via `toolNames`. Named Agents use `agents/<name>.agent.md` (file name must be lowercase kebab, e.g., `agents/planner.agent.md`): the entire Markdown file is that Agent's instructions, and the first heading line serves as the description. See `examples/test-bot/agents/planner.agent.md` for a real-world example.

```markdown
<!-- agents/planner.agent.md -->
# planner

You are **planner** (coordinator): break down user goals, define acceptance
criteria, and coordinate specialist roles.
```

### Plugin `agent/` Directory (An Alternative Organization)

Plugins with `@zhin.js/agent` installed can also use an `agent/` directory to centrally declare the AI surface (`packages/im/agent/src/discovery/agent-surface.ts` scans it):

```text
my-plugin/
├── agent/
│   ├── agent.ts           # defineAgent: description, keywords, toolNames, systemPrompt
│   ├── instructions.md    # System prompt body
│   ├── tools/*.ts         # defineAgentTool (from '@zhin.js/agent/tools')
│   ├── skills/*.{md,ts}   # .md can have frontmatter (description / tools / always)
│   └── subagents/<name>/  # Recursively isomorphic sub-Agents
```

The difference from `@zhin.js/tool`'s `defineAgentTool`: the `@zhin.js/agent/tools` version's `execute(input, ctx)` receives `{ pluginName, runtimeName, filePath }` context as the second argument, `approval` supports `'always' | 'once' | 'never'` or a custom predicate, and it can configure `toModelOutput` to shape the text returned to the model. Real-world example: `plugins/utils/short-url/agent/tools/short_url.ts`.

```ts
// agent/tools/short_url.ts (plugins/utils/short-url, excerpt)
import { defineAgentTool } from '@zhin.js/agent/tools';
import { z } from 'zod';

export default defineAgentTool<{ url: string }>({
  description: 'Shorten a URL and return the short link',
  inputSchema: z.object({ url: z.string().min(1) }),
  keywords: ['短链', '缩短', 'shorten'],
  async execute({ url }) {
    // ...
  },
});
```
