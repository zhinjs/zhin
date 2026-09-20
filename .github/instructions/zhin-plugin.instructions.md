---
applyTo: "plugins/**,examples/**"
---

# Zhin Plugin Runtime authoring

## Package contract

- Every Plugin is an npm package with `package.json#zhin`, `plugin.ts` and optional `schema.json`.
- `plugin.ts` default-exports `definePlugin()` from `zhin.js` (Feature package authors may
  import from `@zhin.js/plugin-runtime` directly); it owns lifecycle and
  Resources, not capability registration.
- Child packages live one level below `plugins/*`. Logical ancestry comes from `zhin.plugins`, not
  nested directories.
- Feature providers are explicit `zhin.features` mounts. Apps that depend on `zhin.js` inherit
  Stable Features via `platformFeatures` — do **not** separately install `@zhin.js/command` /
  `@zhin.js/middleware` / `@zhin.js/handler` / `@zhin.js/adapter` / `@zhin.js/component`.

## Convention directories

```text
adapters/<name>/index.ts              defineAdapter()      // import from zhin.js/adapter
commands/**/index.ts                  defineCommand()      // directory path is the route
components/<name>/index.ts            defineComponent()    // import from zhin.js/component
middlewares/<name>/index.ts           defineMiddleware()   // import from zhin.js/middleware
handlers/<name>/index.ts              defineHandler()      // explicit event supports dotted runtime names
tools/<name>/index.ts                 defineAgentTool()
skills/<name>/SKILL.md                Markdown Skill SSOT
skills/<name>/tools/<name>/index.ts   Skill-private defineAgentTool()
agents/<name>/agent.json              Agent metadata SSOT
agents/<name>/tools/<name>/index.ts   Agent-private defineAgentTool()
agents/<name>/skills/<name>/SKILL.md  Agent-private Skill SSOT
agents/<name>/skills/<name>/tools/<name>/index.ts
                                      Agent-Skill-private defineAgentTool()
mcps/<name>/index.ts                  defineMcp()
schedules/<name>/index.ts             defineSchedule()
pages/<name>/index.tsx                definePage()
pages/{nav,footer}/index.tsx           layout overrides
```

Each TypeScript capability default-exports exactly one definition. Do not call `usePlugin()`,
`getPlugin()` or `add*()` in new code. Migrate old code with
`.github/skills/migrate-zhin-plugin-runtime`.

Tool placement is an authority and disclosure boundary. Root Tools are plugin-wide; Agent Tools
require that Agent; Skill Tools unlock only after `load_skill`; Agent-Skill Tools require both.
Do not place a domain-specific Tool at package root merely to make discovery convenient.

## Imports and native TypeScript

- Local imports use `.js` specifiers.
- Import Stable Feature `define*` from `zhin.js/*` facade subpaths when the app depends on `zhin.js`.
  Import IM execution contracts from `zhin.js/core/runtime` (or `@zhin.js/core/runtime`).
- Node-authored files must use erasable TypeScript syntax. Do not use enums, namespaces,
  constructor parameter properties or TSX in server capability directories.
- Browser `pages/*/index.tsx` entries are compiled by the Client Build adapter and are not imported by Node.

## Command routes

The file path is the route SSOT:

```text
commands/gh/issue/list/index.ts    gh issue list
commands/gh/pr/[[title]]/index.ts  gh pr [title]
```

Dynamic parameter directories use Next.js-style brackets: `[name]` required, `[[name]]` optional,
`[...name]` catch-all, `[[...name]]` optional catch-all. Type and default value are declared
in `defineCommand({ params })` — `params.<name>.type` is required, `default` is optional (a default
requires the double-bracket file form). Catch-all parameters are `string[]` at runtime.

Read parsed values from `context.params`, extra words from `context.args`, and the inbound Message
from `context.input`. Do not duplicate route metadata inside the definition — but parameter type
and default must live in `defineCommand({ params })`, not in the file name.

## Config, Resources and lifecycle

- `schema.json` declares only the package's own config fields. Root values are under `plugin`;
  child values are under `plugins.<instanceKey>` recursively.
- Capability callbacks use owner-scoped `context.config` and `context.use(token)`.
- Shared database, router, credentials and connections are Plugin Resources, never module globals.
- Register setup cleanup with `context.lifecycle`. Adapter authors should return the compact
  `{ client, connect, activate?, send }` implementation described in
  `docs/authoring/adapters.md`; the
  framework owns Endpoint identity and `start -> open -> close -> stop`. Extend `Endpoint` only
  when a protocol needs custom multi-stage lifecycle behavior.
- Do not mutate RuntimeSnapshot projections or maintain a second registry.

## AI capabilities

```typescript
import { defineAgentTool } from '@zhin.js/tool';

export default defineAgentTool({
  description: 'Synchronize records',
  inputSchema: {},
  async execute(input, context) {
    return context.config;
  },
});
```

Tool, Skill, Agent and MCP Features are optional mounts. IM-only packages must not pull model SDKs,
Zod or `@zhin.js/agent` into their production dependency closure unless their public contract needs
them.

## Validation

Run the smallest relevant package build/test, then `zhin runtime migrate status` for migrated
packages. Runtime code is complete only after a real Root start or domain-level execution test;
TypeScript compilation alone is insufficient.
