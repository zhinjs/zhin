---
applyTo: "plugins/**,examples/**"
---

# Zhin Plugin Runtime authoring

## Package contract

- Every Plugin is an npm package with `package.json#zhin`, `plugin.ts` and optional `schema.json`.
- `plugin.ts` default-exports `definePlugin()` from `zhin.js/plugin-runtime` (or
  `@zhin.js/plugin-runtime` when authoring a Feature package itself); it owns lifecycle and
  Resources, not capability registration.
- Child packages live one level below `plugins/*`. Logical ancestry comes from `zhin.plugins`, not
  nested directories.
- Feature providers are explicit `zhin.features` mounts. Apps that depend on `zhin.js` inherit
  Stable Features via `platformFeatures` — do **not** separately install `@zhin.js/command` /
  `@zhin.js/middleware` / `@zhin.js/handler` / `@zhin.js/adapter` / `@zhin.js/component`.

## Convention directories

```text
adapters/**/*.ts                 defineAdapter()      // import from zhin.js/adapter
commands/**/*.ts                 defineCommand()      // import from zhin.js/command
components/**/*.ts               defineComponent()    // import from zhin.js/component
middlewares/**/*.ts              defineMiddleware()   // import from zhin.js/middleware
handlers/**/*.ts                 defineHandler()      // import from zhin.js/handler; `.`-joined event name
tools/*.ts                       defineAgentTool()
skills/<name>/SKILL.md           Markdown Skill SSOT
agents/<name>.agent.md           Markdown Agent SSOT
mcp/*.ts                         defineMcp()
pages/*.ts|tsx                   definePage()
pages/$nav.tsx|$footer.tsx       layout overrides
```

Each TypeScript capability default-exports exactly one definition. Do not call `usePlugin()`,
`getPlugin()` or `add*()` in new code. Migrate old code with
`.github/skills/migrate-zhin-plugin-runtime`.

## Imports and native TypeScript

- Local imports use `.js` specifiers.
- Import Stable Feature `define*` from `zhin.js/*` facade subpaths when the app depends on `zhin.js`.
  Import IM execution contracts from `zhin.js/core/runtime` (or `@zhin.js/core/runtime`).
- Node-authored files must use erasable TypeScript syntax. Do not use enums, namespaces,
  constructor parameter properties or TSX in server capability directories.
- Browser `pages/*.tsx` are compiled by the Client Build adapter and are not imported by Node.

## Command routes

The file path is the route SSOT:

```text
commands/gh/issue/list.ts    gh issue list
commands/gh/pr/[[title]].ts  gh pr [title]
```

Dynamic parameter files use Next.js-style brackets: `[name].ts` required, `[[name]].ts` optional,
`[...name].ts` catch-all, `[[...name]].ts` optional catch-all. Type and default value are declared
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
- Register setup cleanup with `context.lifecycle`. Endpoint admission uses
  `start -> open -> close -> stop`; all operations must be idempotent.
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
