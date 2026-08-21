# Legacy Concept Migration Guide

After zhin.js 4.x completed the Plugin Runtime consolidation, the following legacy concepts are no longer used in public-facing documentation. This page explains each old concept -- "what it was then and where it went" -- for reference when maintaining old plugins, reading legacy code, or consulting old docs. For the API-level deprecation list, see [Public API Surface](./public-api-surface.md).

## `usePlugin()` Plugin System -> Convention-based plugin.ts + definePlugin

- **Old approach**: `usePlugin()` from `@zhin.js/core` -- a React Hooks-like design that uses AsyncLocalStorage to locate the calling file and automatically build the plugin tree. The constraint is that it must be called at module top level (gate: `pnpm check:use-plugin-top-level`). This function still exists in `packages/im/core/src/plugin.ts` for backward compatibility with the legacy app layer (`packages/im/zhin`).
- **New approach**: A convention-based `plugin.ts` at the plugin package root that default-exports `definePlugin(...)` (`zhin.js`). Commands, middleware, adapters, etc. go in convention directories (`commands/`, `middlewares/`, `adapters/`...) for auto-discovery. See [definePlugin](../authoring/define-plugin.md) and [Convention Directories](../authoring/conventions.md).

```ts
// Old: const plugin = usePlugin(); plugin.command('ping', ...);
// New (plugin.ts):
export default definePlugin({
  name: 'my-plugin',
  setup(context) { /* context.resources / context.lifecycle assembly */ },
});
```

## "Host Plugin" Narrative -> basic/cli Assembly + Host Tokens

- **Old approach**: `@zhin.js/host` series router / api plugin packages that installed HTTP routing and Console API as "plugins" (these packages have been deleted).
- **New approach**: The Host is a composition root -- `basic/cli`'s `zhin runtime start` assembles IM / Agent / Console Host uniformly. Plugins do not install Hosts; instead they consume Host capabilities through Host tokens in `setup` (`zhin.js` exports six tokens like `databaseHostToken`, `@zhin.js/host-http` exports `httpHostToken`). When a token is not assembled, use `has()` to check and degrade gracefully.

```ts
// Old: Install host plugin to get HTTP capability
// New (inside plugin.ts setup):
if (context.resources.has(httpHostToken)) {
  context.resources.use(httpHostToken).route('GET', '/hello', handler);
}
```

## Old Manifest / `plugin.yml` -> package.json `zhin` Field

- **Old approach**: A `plugin.yml` manifest at the plugin root (`PluginManifest`, marked deprecated; legacy `Plugin` and `zhin build` still recognize it, see `basic/cli/src/libs/plugin-package-build.ts`).
- **New approach**: The `zhin` field in `package.json`, parsed and strictly validated by `@zhin.js/runtime` (`packages/im/runtime/src/manifest.ts`). For field-by-field documentation, see [definePlugin - package.json zhin field](../authoring/define-plugin.md).

```jsonc
// Old: plugin.yml describes plugin entry and metadata
// New (package.json):
{ "zhin": { "protocol": 1, "type": "plugin", "entry": "./plugin.ts" } }
```

## `extends Adapter` Class Adapter -> defineAdapter

- **Old approach**: Extending the `Adapter` base class from `@zhin.js/core` to implement platform adapters (the class still exists in `packages/im/core/src/adapter.ts` for the legacy app layer).
- **New approach**: Default-export `defineAdapter({ capabilities, create })` (`@zhin.js/adapter`) from a file in the convention `adapters/` directory, declaring IO capabilities via `capabilities` (`inbound` / `outbound`). Endpoint instance configuration comes from the app config `plugins.<instanceKey>`, with the structure described by the plugin package's `schema.json`.

```ts
// Old: class MyAdapter extends Adapter { /* ... */ }
// New (adapters/my.ts):
export default defineAdapter<MyConfig>({
  capabilities: ['inbound', 'outbound'],
  create(context) { /* return EndpointInstance */ },
});
```

## Old Console loginAssist → Plugin Runtime LoginAssist

- **Old approach**: The loginAssist page/route provided by the Console plugin — adapters posted pending tasks like QR code scans and slider verifications, and users consumed/confirmed them in the Web Console. The old Console page has been removed.
- **Current status (Plugin Runtime)**: `ImRuntime` provides `loginAssistToken`; ICQQ (and similar adapters) call `waitForInput` on `system.login.*`. Consumers:
  - Console RPC: `login.list` / `login.submit` / `login.cancel` (refresh-safe via `list`)
  - SSE: `endpoint.login.pending` / `endpoint.login.expired`
  - Interactive TTY: one-line stdin confirm (aligned with the official icqq example)
- Out-of-band path still works: `icqq login <uin>` daemon QR scan, then start zhin; `zhin setup` wizard.

## Legacy Multi-Agent Execution APIs -> chat subagent / Workroom

The old orchestration stack combined mutable repositories, `AgentDispatcher`, immediate-execution workflow helpers, and `remote_mesh` state. It could not reliably represent acceptance, lease recovery, preemption, or Project Memory, so it is replaced in a major release without a dual-write compatibility layer.

| Legacy surface | Migration |
| --- | --- |
| `runPipeline` / `runParallel` / `route` from `zhin.js/agent` | Use `AIService.runAgent` for an ordinary one-shot model call (compose Promises explicitly when needed). Durable multi-Agent collaboration enters a Workroom Inbox/Plan proposal. A future workflow builder will only construct Plans; it will not execute Agents. |
| `spawn_task(run_id, task_id, ...)` | Ordinary chat keeps only temporary `spawn_task` without Workroom identity. Project work must be created as a Workroom Task/Assignment; a subtask id is never a Task id. |
| `OrchestrationService` / `OrchestrationKernel` / repositories / `AgentDispatcher` | There is no compatibility object. Read state from Workroom Journal replay/projections; write only through principal- and role-scoped Workroom command ports. |
| `ai.remoteAgents` / `remote_mesh` / Remote Agent poller | No longer supported. Remote A2A will attach as a standard `AssignmentExecutorPort` adapter using the same lease/fence/report/acceptance contract as local execution. Do not emulate it with legacy configuration before that adapter ships. |
| `/api/agent/orchestration/runs` / `/console/orchestration` | Use the Project-scoped `/api/agent/workroom/runs?projectId=...` endpoint and Workroom Console page. Both are read-only projections. |

Legacy Runs are not automatically resumed or promoted. In particular, an old `completed` record has no claim-level Acceptance Record and cannot become accepted Project State. Historical data may only be exported for offline audit, or reintroduced as an untrusted Inbox/Evidence candidate with `legacy_import` provenance for explicit replanning and acceptance. See the [Agent CONTEXT](../../../packages/im/agent/CONTEXT.md) for the implemented authority boundary.

## Related Reading

- [Plugin Model](../concepts/plugin-model.md): Conceptual overview of the Plugin Runtime
- [definePlugin](../authoring/define-plugin.md): New plugin declaration and `package.json` `zhin` field
- [Repo Structure](./repo-structure.md): Layered architecture and dependency direction
