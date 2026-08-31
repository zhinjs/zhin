# Capability Seam

Capability Seam is an **Advanced / experimental** provider extension for the Agent Runtime. Regular
plugins should continue to use `tools/*.ts`, `agent/skills/*.md`, `addTool`, or `addSkill`.
Those Feature paths provide manifest ownership, owner visibility, Generation HMR, and conflict
validation. Seam is intended for a Root Host that must connect a remote capability service or an
existing generation-owned registry.

## Production path

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

`CapabilityIngress` reads `capabilitySeamToken` from the Root resources in one fixed Runtime
snapshot. It projects the services into the same capability snapshot as Tool and Skill Features.
Only `TurnToolRuntime` executes a projected Tool. The deprecated `executeTool(name, args)` method
is retained for source compatibility, but always returns a fail-closed migration error.

This preserves the production invariants:

- a provider cannot execute after its Generation operation retires;
- `platforms`, `scopes`, `permissions`, and `hidden` use canonical visibility checks;
- `approval` is enforced by the Turn ApprovalPort and fails closed without an interactive port;
- Tool calls, denials, failures, and results enter the same Turn Journal;
- duplicate Feature and Seam Tool or Skill names reject capability projection.

## Service contracts

A `ToolService` supplies schemas and the final provider call. Policy metadata on `ToolSchema`
is copied into the canonical Tool capability. Omitted `approval` defaults to `on-risk`.

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
      approval: 'never',
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
remain under the Agent capability plan. Direct Skill invocation is deprecated and fail-closed.

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

## Root registration and lifecycle

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

The old `seamIntegrationToken` Symbol remains only for source compatibility and is not consumed
by Plugin Runtime Scope. Migrate to `capabilitySeamToken`. The old `executeTool()` and
`invokeSkill()` methods also return fail-closed errors.

## Scope and conflicts

- `global` providers are visible to every Agent owner under the Root.
- A provider registered with an owner string is visible only for that owner lookup.
- Duplicate provider IDs in one scope fail during registration.
- A scoped provider can replace a global provider with the same ID.
- Duplicate visible Tool or Skill names fail during capability projection.

## Existing adapters

| Class | Purpose |
|---|---|
| `BuiltinToolService` | Adapts QuestionPort interaction for custom Host compositions |
| `ToolRegistryAsService` | Explicitly bridges a generation-owned `ToolRegistry` |
| `SkillRegistryAsService` | Explicitly bridges a generation-owned `SkillRegistry` and reads Skill documents |

The standard Agent Host does not publish these adapters globally. Built-in Tool and Skill
capabilities continue to use Feature projection, preserving one visibility and lifecycle model.

## Feature or Seam?

| Scenario | Preferred entry |
|---|---|
| Regular Tool or Skill in an npm plugin | Feature directory or `addTool` / `addSkill` |
| Manifest ownership and file-level HMR | Feature |
| Root Host remote provider or existing registry | Capability Seam |
| Bypassing approval or direct execution by name | Unsupported; use a Turn capability |

See also: [Plugin Model](./plugin-model.md) · [Generation Lifecycle](./generation-lifecycle.md) ·
[Agent Tool Authoring](../authoring/agent-tools.md) · [Architecture](./architecture.md)
