# Legacy Concept Migration Guide

After the Plugin Runtime consolidation, the following legacy concepts are no longer used in public-facing documentation. This page explains each old concept -- "what it was then and where it went" -- for reference when maintaining old plugins, reading legacy code, or consulting old docs. For the API-level deprecation list, see [Public API Surface](./public-api-surface.md).

## `usePlugin()` Plugin System -> Convention-based plugin.ts + definePlugin

- **Old approach**: `usePlugin()` from `@zhin.js/core` -- a React Hooks-like design that used AsyncLocalStorage to locate the calling file and automatically build the plugin tree. The API is absent from source and the public surface; `pnpm check:no-removed-plugin-api` prevents its reintroduction.
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
- **New approach**: The Host is a composition root -- the instance composition root `zhin.js/instance` (launched by the management gateway that `zhin start` runs) assembles IM / Agent / Console Host uniformly. Plugins do not install Hosts; instead they consume Host capabilities through Host tokens in `setup` (`zhin.js` exports six tokens like `databaseHostToken`, `@zhin.js/host-http` exports `httpHostToken`). When a token is not assembled, use `has()` to check and degrade gracefully.

```ts
// Old: Install host plugin to get HTTP capability
// New (inside plugin.ts setup):
if (context.resources.has(httpHostToken)) {
  context.resources.use(httpHostToken).route('GET', '/hello', handler);
}
```

## Old Manifest / `plugin.yml` -> package.json `zhin` Field

- **Old approach**: A `plugin.yml` manifest at the plugin root. That format and the `PluginManifest` type are absent from source, build detection, and the public surface.
- **New approach**: The `zhin` field in `package.json`, parsed and strictly validated by `@zhin.js/runtime` (`packages/im/runtime/src/manifest.ts`). For field-by-field documentation, see [definePlugin - package.json zhin field](../authoring/define-plugin.md).

```jsonc
// Old: plugin.yml describes plugin entry and metadata
// New (package.json):
{ "zhin": { "protocol": 1, "type": "plugin", "entry": "./plugin.ts" } }
```

## `extends Adapter` Class Adapter -> defineAdapter

- **Old approach**: Extending the `Adapter` base class from `@zhin.js/core` to implement platform adapters. That class and the matching Core `Endpoint` runtime have been deleted.
- **New approach**: Default-export `defineAdapter({ capabilities, create })` (`@zhin.js/adapter`) from a file in the convention `adapters/` directory, declaring IO capabilities via `capabilities` (`inbound` / `outbound`). Endpoint instance configuration comes from the app config `plugins.<instanceKey>`, with the structure described by the plugin package's `schema.json`.

```ts
// Old: class MyAdapter extends Adapter { /* ... */ }
// New (adapters/my.ts):
export default defineAdapter<MyConfig>({
  capabilities: ['inbound', 'outbound'],
  create(context) { /* return an Endpoint<Client> subclass instance */ },
});
```

## Old Console loginAssist → Plugin Runtime LoginAssist

- **Old approach**: The loginAssist page/route provided by the Console plugin — adapters posted pending tasks like QR code scans and slider verifications, and users consumed/confirmed them in the Web Console. The old Console page has been removed.
- **Current status (Plugin Runtime)**: `ImRuntime` provides `loginAssistToken`; ICQQ (and similar adapters) call `waitForInput` on `system.login.*`. Consumers:
  - Console RPC: `login.list` / `login.submit` / `login.cancel` (refresh-safe via `list`)
  - SSE: `endpoint.login.pending` / `endpoint.login.expired`
  - Interactive TTY: one-line stdin confirm (aligned with the official icqq example)
- Out-of-band path still works: `icqq login <uin>` daemon QR scan, then start zhin; `zhin setup` wizard.

## Legacy Multi-Agent Execution APIs -> Agent Harness {#legacy-multi-agent}

The old orchestration stack (mutable repositories, `AgentDispatcher`, executing workflow helpers, `remote_mesh`) and the later Workroom Kernel have both been removed without a compatibility layer. Multi-Agent collaboration now has a single model: the Agent Harness ([ADR 0048](../../adr/0048-agent-harness.md)).

| Old surface | Migration |
| --- | --- |
| `runPipeline` / `runParallel` / `route` from `zhin.js/agent` | Use `AIService.runAgent` for an ordinary one-shot model call (compose Promises explicitly when needed). For multi-Agent collaboration, let Agents use the collaboration tools such as `ask` / `delegate`. |
| `spawn_task(run_id, task_id, ...)` | `spawn_task` has been removed; Agents collaborate through `ask` / `delegate` and the other collaboration tools (see [Agent deep dive · Multi-Agent collaboration](../ai/agent.md#multi-agent-collaboration)). |
| `OrchestrationService` / `OrchestrationKernel` / repositories / `AgentDispatcher` | There is no compatibility object. Collaboration state is read only from the `engagement_events` Journal (`zhin trace --engagements`, the Console collaboration graph). |
| `ai.remoteAgents` / `remote_mesh` / Remote Agent poller | No longer supported; startup fails when `ai.remoteAgents` is present. Declare remote Agents under `a2a.mailbox.peers`; each Mail is signed together with its Authority and budget. |
| `ai.workroom` / `ai.workrooms`, `a2a.workroomCallbacks` / `a2a.workroomRemoteExecutors`, `@zhin.js/workroom` | Removed; startup fails when these keys are present. Declare groups or channels shared by several Bots under `ai.venues`, and each Agent's contacts and budget ceiling under `collaboration` in `agents/<name>/agent.json`. |
| `/api/agent/orchestration/runs`, `/api/agent/workroom/runs` | Use the read-only `GET /api/agent/engagements[/*]` endpoint and the Console Workroom page. |

Old Runs, Workroom Journals, and Catalogs are no longer supported and there is no migration tooling; to keep historical information, curate it by hand and resubmit it as a new message. See the [Agent CONTEXT on GitHub](https://github.com/zhinjs/zhin/blob/main/packages/im/agent/CONTEXT.md) for the implemented authority boundary.

## Related Reading

- [Plugin Model](../concepts/plugin-model.md): Conceptual overview of the Plugin Runtime
- [definePlugin](../authoring/define-plugin.md): New plugin declaration and `package.json` `zhin` field
- [Repo Structure](./repo-structure.md): Layered architecture and dependency direction
