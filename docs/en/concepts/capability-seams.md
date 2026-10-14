---
title: "Capability Seam"
description: "Let a Root Host connect a remote capability service or an existing tool registry to the Agent: when to use it, the service contracts, registration, and how it shares the permission and approval path with regular Tools"
---

# Capability Seam

Most plugins **don't need** this page. To write Tools and Skills, use the convention directories `tools/<name>/index.ts` and `skills/<name>/SKILL.md`, or `addTool` / `addSkill`; they come with a manifest, ownership, hot reload, and duplicate-name checks.

Capability Seam is an advanced extension point for the **Root Host** (the layer that assembles the whole runtime). Reach for it only when you need to connect a remote capability service, an existing tool registry, or a provider that doesn't fit in a single file.

::: warning Experimental
This is an Advanced / experimental interface; signatures may change between versions.
:::

## Do you need it?

| Your situation | Use |
|---|---|
| Writing a regular Tool / Skill in a plugin | Convention directories (`tools/`, `skills/`) or `addTool` / `addSkill` |
| You want a manifest, ownership, and hot reload on file save | Same as above (Feature) |
| Connecting a remote capability service or existing registry in the Root Host | **Capability Seam** |
| Bypassing approval or executing a tool directly by name | Not supported through any entry |

## Write a capability service

A `ToolService` supplies schemas and the final provider call. Policy metadata on `ToolSchema`
is copied into the canonical Tool capability. Omitted `requiresApproval` defaults to `on-risk`.

```ts
import type {
  ToolExecutionResult,
  ToolSchema,
  ToolService,
} from '@zhin.js/agent'

export class SearchService implements ToolService {
  readonly id = 'acme:search'
  readonly description = 'Acme remote search'

  schema(): ToolSchema[] {
    return [{
      type: 'function',
      function: {
        name: 'acme_search',
        description: 'Search the Acme knowledge base',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
      requiresApproval: 'never',
      permissions: ['authenticated'],
      source: 'remote:acme',
    }]
  }

  async execute(_scope, toolName, input, context): Promise<ToolExecutionResult> {
    if (toolName !== 'acme_search') {
      return { success: false, error: `Unknown tool: ${toolName}` }
    }
    if (!context) return { success: false, error: 'Turn context required' }
    context.signal.throwIfAborted()
    return { success: true, output: await searchAcme(input, context.signal) }
  }
}
```

A `SkillService` is a declarative catalog. `catalog()` returns names and summaries, while
`describe()` returns complete instructions. Skill loading, prompt assembly, and Tool selection
remain under the Agent capability plan; direct Skill invocation is not part of the contract.

```ts
import type { SkillService } from '@zhin.js/agent'

export class ResearchSkills implements SkillService {
  readonly id = 'acme:skills'
  readonly description = 'Acme research workflows'

  async catalog() {
    return [{ name: 'acme_research', description: 'Research with Acme sources' }]
  }

  async describe(_scope, skillId: string) {
    if (skillId !== 'acme_research') throw new Error('Skill not found')
    return '# Acme research\nUse acme_search, cite source IDs, then summarize.'
  }
}
```

## Register it on the Root

Seam is an explicit Root resource. Registrations return idempotent disposers, and the Root Scope
owns disposal of the complete `SeamIntegration`. Providers therefore prepare, publish, roll back,
and retire with their candidate Generation.

```ts
import {
  SeamIntegration,
  capabilitySeamToken,
} from '@zhin.js/agent'
import { definePlugin } from 'zhin.js/plugin-runtime'
import { ResearchSkills } from './research-skills.js'
import { SearchService } from './search-service.js'

export default definePlugin({
  name: 'my-agent-root',
  setup({ resources }) {
    const seams = new SeamIntegration()
    seams.registerToolService('global', new SearchService())
    seams.registerSkillService('global', new ResearchSkills())
    resources.provide(capabilitySeamToken, seams, () => seams.dispose())
  },
})
```

Do not store `SeamIntegration` in module-level state or mutate a retired Generation. Dynamic
provider changes should produce a new Runtime Generation.

Capability Seam enters Plugin Runtime Scope only through `capabilitySeamToken`. `SeamIntegration`
only registers providers and projects capabilities; it does not expose direct `executeTool()` or
`invokeSkill()` methods.

## How it works

Tools from a Seam **go through the same execution path** as regular Tools; there is no side door:

```text
Tool / Skill Feature ─┐
                      ├─ CapabilityIngress ─ immutable AgentCapabilities
Root Capability Seam ─┘                         │
                                                ▼
                                          TurnIngress
                                                │
                                                ▼
                                        TurnToolRuntime
                         generation → permission → approval → journal
                                                │
                                                ▼
                                           Provider
```

`CapabilityIngress` reads the Root's `capabilitySeamToken` from a fixed runtime snapshot and turns the services into the same capability description as regular Tools and Skills. Seam Tools have no separate `executeTool(name, args)` path; only `TurnToolRuntime` can run them, inside a turn. That gives these guarantees:

- **Follows hot reload**: once its generation retires or the operation ends, the provider can no longer be called;
- **Same visibility filters**: `platforms`, `scopes`, `permissions`, and `hidden` apply exactly as for regular Tools;
- **Same approval**: `requiresApproval` is handled by the turn's approval port; when approval is needed and nobody is there to answer, the call is refused;
- **Same record**: calls, denials, failures, and results go into the same run log (Turn Journal);
- **Duplicates fail loudly**: a regular Tool and a Seam Tool / Skill with the same name make the new capability snapshot fail instead of silently overriding.

### Scope and conflicts

- `global` providers are visible to every Agent owner under the Root.
- A provider registered with an owner string is visible only for that owner lookup.
- Duplicate provider IDs in one scope fail during registration.
- A scoped provider can replace a global provider with the same ID.
- Duplicate visible Tool or Skill names fail during capability projection.

::: details Existing adapters
| Class | Purpose |
|---|---|
| `BuiltinToolService` | Adapts QuestionPort interaction for custom Host compositions |
| `SkillRegistryAsService` | Explicitly bridges a generation-owned `SkillRegistry` and reads Skill documents |

The standard Agent Host does not publish these adapters globally. Built-in Tool and Skill
capabilities continue to use Feature projection, preserving one visibility and lifecycle model.
:::

## Related

- [Plugin Model](./plugin-model.md): how Features and convention directories are discovered
- [Generation and Lifecycle](./generation-lifecycle.md): how capabilities are prepared, published, and retired across hot reloads
- [Agent Tools and Skills](../authoring/agent-tools.md): how regular plugins write Tools and Skills
- [Layered Architecture](./architecture.md): layer responsibilities and dependency direction
