# definePlugin

`definePlugin(...)` declares a plugin's assembly boundary: identity, dependencies, and `setup(context)`. It needs no base class and creates no private registry.

## Choose the authoring surface first

| Need | Use | Why |
| --- | --- | --- |
| One command, component, middleware, or tool | Convention directory | One file is one capability with file-level HMR |
| Shared resources or lifecycle across capabilities | `setup` in `plugin.ts` | Assemble resources and cleanup in one Scope |
| A discoverable capability for the ecosystem | Feature package | Own parsing, validation, projection, and authoring types |

Choose one surface for a capability. Runtime rejects a same-name `setup` registration and convention file as a duplicate; neither silently wins.

```ts
import { definePlugin } from 'zhin.js';

export default definePlugin<MyConfig>({
  name: 'my-plugin',
  metadata: { displayName: 'My Plugin', icon: 'Blocks', order: 10 },
  requires: [databaseHostToken],
  async setup(context) {
    // Assembly: register runtime resources beyond commands (tables, cron, Agent tools, outbound push...)
    return () => { /* Runs when the generation ends */ };
  },
});
```

`name` is required and must match `^[a-z][a-z0-9-]*$`. The definition is frozen. `setup` may be synchronous or asynchronous and may return a `Dispose` that runs when the current generation ends.

> Starting from scratch: for the shortest example see [single-file-bot](../examples/index.md#single-file-bot-一个-botts-就是机器人); for the convention directories tutorial see [Writing Your First Plugin](../getting-started/first-plugin.md); for concepts see [Plugin Model](../concepts/plugin-model.md).

## setup context

The `PluginSetupContext<TConfig>` received by `setup` has all read-only members:

| Member | Type | Purpose |
| --- | --- | --- |
| `plugin` | `PluginInstanceView` | Instance view: `id` / `instanceKey` / `parent` / `root` / `role` (`'root' \| 'child'`). Isolated by `instanceKey` in multi-instance deployments |
| `config` | `ConfigView<TConfig>` | Configuration view, `config.get()` returns a read-only config. Defaults come from the plugin package's `schema.json`, overridden by the `plugin:` section (for Root itself) or `plugins.<key>` section of `zhin.config.yml` |
| `resources` | `Scope` | Resource scope: `has(token)` / `use(token)` resolve Host tokens, `provide(token, value, dispose?)` publishes resources to child scopes |
| `lifecycle` | `DisposeStack` | Generation's cleanup stack: cleanup functions registered via `lifecycle.add(dispose)` run in reverse order when the generation ends |
| `handoff` | `GenerationHandoffRegistry` | Generation handoff registry: `handoff.add(participant)` participates in hot reload transactions (see "Generation Handoff" below) |
| `addFeature(feature, name, definition)` | General Feature registration entry point | Registers an in-memory definition as the current plugin's Capability; still goes through provider validation, conflict detection, and generation transaction |

After importing a Stable Feature's authoring package, the context gains corresponding shortcut methods through type augmentation:
`addCommand`, `addComponent`, `addMiddleware`, `addHandler`, `addAdapter`. Optional AI capabilities also provide
`addAgent`, `addSkill`, `addTool`, `addMcp`. These are just strongly-typed narrowings of `addFeature`,
they do not create a second registry.

```ts
import { defineCommand } from 'zhin.js/command';
import { defineComponent } from 'zhin.js/component';
import { definePlugin } from 'zhin.js';

export default definePlugin({
  name: 'single-file-bot',
  setup({ addCommand, addComponent }) {
    addCommand('hello', defineCommand({
      description: 'Say hello',
      execute: () => 'Hello.',
    }));
    addComponent('status', defineComponent({
      render: () => 'online',
    }));
  },
});
```

The shortcut registration and the directory discovery of `commands/hello.ts`, `components/status.tsx` ultimately produce the same
`CapabilitySlot`. Having both with the same name will report `Duplicate Capability Slot` during the prepare phase; failing to mount the corresponding
Feature will also refuse startup. Modifying the single-file entry rebuilds that plugin's Scope; splitting into convention directories enables
single-capability file-level HMR.

Custom Features can declare their shortcut method name (must be in `addXxx` form) via the provider's `authoring.setupMethod`; the Runtime dynamically installs it. The TypeScript type is provided by that Feature's module augmentation of `PluginSetupContext`. The Runtime does not maintain a Feature name whitelist.

A real assembly example makes this clear (`examples/capabilities-bot/plugin.ts`, excerpt):

```ts
async setup(context) {
  const { instanceKey } = context.plugin;            // 1. Instance view
  const config = context.config.get();               // 2. Configuration view
  if (context.resources.has(databaseHostToken)) {    // 3. Resource scope
    const db = context.resources.use(databaseHostToken);
    db.define('showcase_counter', { /* ... */ });
  }
  context.lifecycle.add(schedule.register({ /* ... */ })); // 4. Lifecycle cleanup
  return () => console.log('disposed');              // 5. setup returns Dispose
}
```

### Scope Resolution Rules

`resources` is a parent-child chain: `use(token)` first checks the local scope, then recurses up to parent scopes if not found; if the entire chain has no match, it throws a `Missing resource` error. Optional capabilities should always use `has(token)` before `use(token)`, degrading gracefully when absent.

## metadata and requires

All three fields of `metadata` serve the Remote Console's plugin card (`/api/plugins`): `displayName` is the display name, `icon` is the icon name, and `order` is the sort weight. None affect runtime behavior.

`requires` declares an array of hard-dependency Host tokens; missing tokens cause the plugin to refuse startup -- complementing the `has()` + graceful degradation soft-dependency path:

```ts
// Hard dependency: won't start without a database
export default definePlugin({
  name: 'my-plugin',
  requires: [databaseHostToken],
  // ...
});
```

## Host token

Host tokens are capability handles provided by the Host to plugins, resolved in `setup` via `context.resources`. The CLI Host automatically assembles them at startup; tokens not assembled are checked with `has()` for graceful degradation. The first six are exported from `zhin.js`, and `httpHostToken` is exported from `@zhin.js/host-http`.

| token | token id | Availability condition | Key methods |
| --- | --- | --- | --- |
| `databaseHostToken` | `zhin.database.host` | `database:` configured | `define(name, columns)` registers a plugin-private logical table; Runtime maps it to a physical name by PluginId, and `models.get(name)` can access only that plugin's tables (`select` / `insert` / `update` / `delete` / `count`) |
| `scheduleHostToken` | `zhin.schedule.host` | Always available | `register(job)` registers a plugin-private logical job id with a 6-field solar cron (`second minute hour day month weekday`), returns a cancel function; `list()` returns only that plugin's jobs |
| `outboundHostToken` | `zhin.outbound.host` | Has available Adapter | `send(input)` proactive push (returns platform message id or `null`); optional `addReaction` / `removeReaction` / `recall` |
| `htmlRendererToken` | `zhin.html-renderer.host` | `@zhin.js/html-renderer` installed | `render(html, { width, format, backgroundColor })` -> PNG (Buffer) or SVG (string); must degrade to plain text when not installed |
| `runtimeEventPublisherToken` | `zhin.runtime.event-publisher` | Root-level, CLI console assembly | `publish(type, data)` broadcasts events to the Console SSE hub (used by adapters to push `endpoint:request` / `endpoint:notice` etc.) |
| `httpHostToken` | `zhin.host.http` | HTTP Host enabled | `route(method, path, handler, meta?)` registers an HTTP route; `ws(path).onConnection(cb)` registers a WS endpoint; `listen()` / `close()` managed by Host |

`databaseHostToken` and `scheduleHostToken` do not expose process-wide lifecycle, Console administration, or the raw database. The CLI owns root lifecycle; plugins use private logical table names and job ids.

Host-token unregister functions belong in `lifecycle`; Tool capabilities are written directly to the candidate generation and need no manual cleanup.

```ts
// Scheduled task: dispose hooked to lifecycle, safely cleaned up on hot reload
if (config.heartbeatCron && context.resources.has(scheduleHostToken)) {
  const schedule = context.resources.use(scheduleHostToken);
  context.lifecycle.add(schedule.register({
    id: 'capabilities-bot/heartbeat',
    cron: config.heartbeatCron,
    description: 'Showcase heartbeat',
    execute: () => log('heartbeat ♥'),
  }));
}

// Agent tool: shares the same candidate capability table as tools/*.ts
context.addTool('showcase_greet', defineAgentTool<{ name?: string }>({
    description: 'Return the configured greeting for a name',
    approval: 'never',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
    execute: (input) => `${config.greeting}，${String(input.name ?? 'world')}！`,
}));
```

## Generation Handoff

Hot reload is a generation transaction: after the candidate completes every fallible readiness step, the snapshot and admission gates publish atomically. The old generation keeps serving until that publish point. `context.handoff.add(participant)` registers a candidate resource participant:

| Hook | Timing |
| --- | --- |
| `activateNext(signal)` | Establish the candidate resource and prove readiness; must support cancellation |
| `deactivateNext()` | Roll back new generation on activation failure |

For example, require a custom resource connection before the generation may publish:

```ts
context.handoff.add({
  activateNext: (signal) => client.connect({ signal }),
  deactivateNext: () => client.close(),
});
```

## Real-World Examples

- **[capabilities-bot](https://github.com/zhinjs/zhin/tree/main/examples/capabilities-bot)**: A single `setup()` in `plugin.ts` exercises all common Host facets (database / schedule / agent-tools / outbound / handoff), each with `has()` graceful degradation, and is the source of all code snippets in this document.
- **[lottery](https://github.com/zhinjs/zhin/tree/main/plugins/utils/lottery)**: database-first with an in-memory fallback; a private token shares domain services; tools use the `@zhin.js/tool` convention directory; cron drives the daily pipeline.

The assembly skeleton of lottery is worth copying:

```ts
// plugins/utils/lottery/plugin.ts (excerpt)
async setup(context) {
  const config = resolveLotteryConfig(context.config.get());
  const db = context.resources.has(databaseHostToken)
    ? context.resources.use(databaseHostToken)
    : createInMemoryLotteryDb();
  if (context.resources.has(databaseHostToken)) {
    defineLotteryTables(db);
  }
  context.resources.provide(lotteryRuntimeToken, { db });

  context.addTool('lottery_sync', createLotterySyncTool());
  // ...cron registration, see scheduleHostToken section
}
```

## package.json `zhin` Field

Plugin packages (and feature packages) declare their manifest using the top-level `zhin` field in `package.json`, replacing the old `plugin.yml`. Parsing and strict validation happen in `@zhin.js/runtime` (`packages/im/runtime/src/manifest.ts`); invalid manifests throw `ManifestValidationError` directly.

```jsonc
{
  "zhin": {
    "protocol": 1,                    // Required, currently always 1
    "type": "plugin",                 // Required: "plugin" | "feature"
    "entry": "./plugin.js",           // Required: published packages use JS; local private Root can use ./plugin.ts directly
    "engine": "^1.0.0",               // Optional: semver requirement for the Runtime engine version, refuses to load if unsatisfied
    "runtime": "trusted",             // Optional (plugin only): "trusted" (default) | "isolated"
    "platformFeatures": true,         // Optional (plugin only): default true, Root plugins automatically get official Stable Features; set false to opt out
    "features": [                     // Optional (plugin only): list of dependent Feature packages, defaults to []
      { "package": "@zhin.js/command", "api": "^1.0.0", "optional": false }
    ],
    "plugins": [                      // Optional (plugin only): list of mounted child plugin instances, defaults to []
      { "package": "@zhin.js/adapter-icqq", "instanceKey": "icqq" }
    ]
  }
}
```

Field details:

| Field | Required | Meaning |
| --- | --- | --- |
| `protocol` | Yes | Manifest protocol version, currently must be `1` |
| `type` | Yes | `plugin` (can mount child plugins, can declare features/runtime) or `feature` (platform capability provider) |
| `entry` | Yes | Plugin/feature entry file, package-relative path, must start with `./` and must not contain `..` |
| `engine` | No | semver range, performs `satisfies` validation against the Runtime-provided engine version |
| `runtime` | No (plugin only) | `isolated` means executing in an isolated runtime: limited to child plugins (not available for Root), cannot mount Host Features, and requires isolation adapter support |
| `platformFeatures` | No (plugin only) | Default `true`: Root plugins get official Stable Features (`@zhin.js/adapter`, `command`, `component`) even without declaring them |
| `features` | No (plugin only) | Dependent Feature packages: `package` supports npm package names or `./` relative paths (monorepo local); `api` is a semver requirement for the Feature's declared `featureApi` version; `optional` marks that absence can be degraded |
| `plugins` | No (plugin only) | Mount child plugin instances: `package` follows the same package name rules as `features`; `instanceKey` **required**, must match `^[a-z0-9][a-z0-9-]*$`, serves as the key for instance isolation and configuration -- multiple instances of the same package use different `instanceKey`s, instance configuration is written under `plugins.<instanceKey>` in the app's `zhin.config.yml` |

Feature packages (`type: "feature"`) have only five fields in their manifest: `protocol` / `type` / `entry` / `engine` / `featureApi`, where `featureApi` (optional) declares the API version implemented by this feature, used for consumer-side `features[].api` validation.

### Development Source and npm Publish Entry

Local Root Plugins and workspace-private plugins can set `zhin.entry` to `./plugin.ts`; Node's native TypeScript support and HMR will load the source directly. Plugins published to npm must declare their entry as `./plugin.js` and include `plugin.js`, generated JavaScript from convention directories, and `lib` in `files`:

```jsonc
{
  "files": ["lib", "plugin.js", "commands", "middlewares"],
  "scripts": {
    "build": "tsc",
    "prepack": "pnpm run build && node ../../../scripts/build-plugin-runtime-entries.mjs",
    "postpack": "node ../../../scripts/build-plugin-runtime-entries.mjs --clean"
  },
  "zhin": {
    "protocol": 1,
    "type": "plugin",
    "entry": "./plugin.js"
  }
}
```

Official plugins in the repository uniformly use `build-plugin-runtime-entries.mjs` during `prepack`: it compiles `plugin.ts` and TypeScript files in convention directories into same-directory JavaScript, and rewrites relative imports pointing to `src/` to point to `lib/` instead; after the tarball is created, `postpack --clean` removes these generated co-located artifacts. The regular `build` does not generate them, so workspace testing and HMR always hit TypeScript source; when loading from `node_modules`, the published JavaScript in the package is preferred, avoiding Node refusing to perform type stripping on dependency packages.

## Next Steps

- [Convention Directories](./conventions.md): How commands / middlewares / adapters directories are discovered
- [Module-Level State](./module-state.md): The correct approach beyond `provide` / module singletons
