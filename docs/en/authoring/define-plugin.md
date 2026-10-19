---
title: "definePlugin"
description: "How to write a plugin entry: name it, declare config, use databases, schedules, proactive messages and AI tools in setup, and clean up correctly on hot reload"
---

# definePlugin: the plugin entry

Every plugin's `plugin.ts` default-exports a `definePlugin({ ... })`. It does three things: **names the plugin**, **declares its config**, and **prepares runtime resources in `setup`** (database tables, scheduled jobs, proactive messaging…).

Individual commands, middleware and components usually live in [convention directories](./conventions.md), not in the entry. This page covers what the entry itself can do.

## Minimal form

```ts
// plugin.ts
import { definePlugin } from 'zhin.js';

export default definePlugin({
  name: 'my-plugin',
});
```

`name` is the only required field: lowercase letters, digits and hyphens, starting with a letter. A plugin that only uses convention directories and has no startup logic needs nothing more.

To do work at startup, add `setup`:

```ts
// plugin.ts
import { definePlugin } from 'zhin.js';

export default definePlugin({
  name: 'my-plugin',
  metadata: { displayName: 'My Plugin', icon: 'Blocks' }, // shown on the Console plugin card
  async setup(context) {
    const config = context.config.get();
    // ...prepare resources
    return () => {
      // runs before unload or hot reload: close timers, connections, etc.
    };
  },
});
```

## In setup, or in a convention directory?

| You want to… | Recommended |
| --- | --- |
| Add one command, middleware, component or AI tool | A convention directory, one file per capability. Editing it reloads only that file |
| Share a database table, client or schedule between several capabilities | Create it in `setup`, then provide it to them |
| Write a whole small bot in one file | Register with shortcuts like `addCommand` in `setup` |

Pick one style per capability. If a command registered in `setup` has the same name as a file in `commands/`, startup fails with `Duplicate Capability Slot` — they never silently override each other.

## Common tasks

### Register commands and components in one file

The `setup` argument has shortcuts — `addCommand`, `addComponent`, `addMiddleware`, `addHandler`, `addAdapter` — that behave exactly like convention directories:

```ts
// plugin.ts
import { definePlugin } from 'zhin.js';
import { defineCommand } from 'zhin.js/command';
import { defineComponent } from 'zhin.js/component';

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

When the file grows, move each definition into `commands/hello/index.ts` or `components/status/index.tsx` as a default export. After the split, editing one command reloads just that command instead of the whole plugin.

### Read config

The simplest way is a `schema.json` (standard JSON Schema) in the plugin root, read in `setup`:

```ts
setup(context) {
  const config = context.config.get(); // schema.json defaults + values from zhin.config.yml
}
```

Values go in the bot's `zhin.config.yml`: your bot's own settings under `plugin:`, child plugins under `<instanceKey>:`. See steps 4 and 5 of [First plugin](../getting-started/first-plugin.md) for a full example.

For config with automatic TypeScript types, declare it inline with `config`:

```ts
// plugin.ts
import { definePlugin, Schema } from 'zhin.js';

const configuration = Schema.object({
  interval: Schema.number().min(1).default(300).description('Polling interval in seconds'),
  apiKey: Schema.string().required().secret().component('password'),
  label: Schema.string(),
});

export default definePlugin({
  name: 'subscription',
  config: configuration,
  setup({ config }) {
    const { interval, apiKey, label } = config.get();
    // interval: number, apiKey: string, label: string | undefined
  },
});
```

- Fields with `.default()` or `.required()` are always present in the type; others are optional.
- `.secret()` makes Console mask the input. The secret value still lives in `zhin.config.yml` as an env reference, e.g. `apiKey: ${SUBSCRIPTION_API_KEY}`.
- Use either `schema.json` or inline `config`, not both — having both refuses to start.

More rules in [Config declaration details](#config-declaration-details) below.

### Use the database

Once `database:` is configured in `zhin.config.yml`, a plugin can define its own tables:

```ts
// plugin.ts
import { databaseHostToken, definePlugin } from 'zhin.js';

export default definePlugin({
  name: 'counter',
  setup(context) {
    if (!context.resources.has(databaseHostToken)) return; // skip when no database is configured
    const db = context.resources.use(databaseHostToken);
    db.define('counter', { /* column definitions */ });
    const counter = db.models.get('counter'); // select / insert / update / delete / count
  },
});
```

Table names are private to the plugin; Zhin maps them to non-conflicting physical names, so plugins can't see each other's tables.

`context.resources` is where a plugin gets framework capabilities: check with `has(token)`, then take it with `use(token)`. If the plugin **cannot work without** the database, declare it in `requires` and startup refuses when it's missing:

```ts
export default definePlugin({
  name: 'counter',
  requires: [databaseHostToken],
  setup(context) {
    const db = context.resources.use(databaseHostToken); // guaranteed to exist
  },
});
```

### Register a scheduled job

```ts
// plugin.ts (inside setup)
import { scheduleHostToken } from 'zhin.js';

const schedule = context.resources.use(scheduleHostToken);
context.lifecycle.add(schedule.register({
  id: 'daily-report',
  cron: '0 0 9 * * *', // sec min hour day month weekday: every day at 9:00
  description: 'Daily report',
  execute: () => sendReport(),
}));
```

`register` returns a cancel function. Hand it to `context.lifecycle.add(...)` and the old job is cancelled on hot reload instead of running twice. A standalone job that shares no state can also go in the `schedules/<name>/index.ts` convention directory.

### Send messages proactively

When the plugin pushes a message on its own (say, a timed reminder) rather than replying to a user, use `outboundHostToken`:

```ts
// plugin.ts (inside setup)
import { outboundHostToken } from 'zhin.js';

const outbound = context.resources.use(outboundHostToken);
await outbound.send({
  adapter: 'qq',
  endpointKey: 'my-bot',
  conversation: { kind: 'group', id: '123456' },
  content: 'Good morning!',
});
```

Proactive sends go through the same rendering, filtering and logging. Never call a platform SDK directly to send messages.

### Register a tool for the AI

```ts
// plugin.ts (inside setup)
import { defineAgentTool } from '@zhin.js/tool';

context.addTool('greet', defineAgentTool<{ name?: string }>({
  description: 'Greet someone with the configured greeting',
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
  },
  execute: (input) => `${config.greeting}, ${String(input.name ?? 'world')}!`,
}));
```

Same effect as `tools/<name>/index.ts`; write it here only when the tool needs resources created in `setup`. See [Agent tools](./agent-tools.md).

### Release resources on hot reload

After you save a file, Zhin prepares the new version first and then stops the old one. Resources the old version acquired must be released by you, or they pile up. Two equivalent styles:

```ts
setup(context) {
  const timer = setInterval(poll, 60_000);
  context.lifecycle.add(() => clearInterval(timer)); // style 1: register at any point
  return () => client.close();                       // style 2: return a cleanup from setup
}
```

Cleanups run in **reverse** registration order. For module-level variables and singletons, see [Module-level state](./module-state.md).

### Provide resources to your own commands and tools

Services created in `setup` can be published with `context.resources.provide(token, value)`; the plugin's commands and tools then `use(token)` them. From the [lottery plugin](https://github.com/zhinjs/zhin/tree/main/plugins/utils/lottery):

```ts
// plugins/utils/lottery/plugin.ts (excerpt)
async setup(context) {
  const config = resolveLotteryConfig(context.config.get());
  const db = context.resources.has(databaseHostToken)
    ? context.resources.use(databaseHostToken)
    : createInMemoryLotteryDb();       // fall back to memory without a database
  if (context.resources.has(databaseHostToken)) {
    defineLotteryTables(db);
  }
  context.resources.provide(lotteryRuntimeToken, { db });
  context.addTool('lottery_sync', createLotterySyncTool());
}
```

## Reference

### setup argument

| Member | Purpose |
| --- | --- |
| `plugin` | Info about this plugin instance: `id`, `instanceKey`, `parent`, `root`, `role` (`'root'` or `'child'`) |
| `config` | `config.get()` returns the read-only config |
| `resources` | Get and provide resources: `has(token)`, `use(token)`, `provide(token, value, dispose?)` |
| `lifecycle` | `lifecycle.add(dispose)` registers cleanups, run in reverse on hot reload or unload |
| `handoff` | Lets custom resources take part in the hot-reload switch; see "Hot-reload handoff" below |
| `addCommand` / `addComponent` / `addMiddleware` / `addHandler` / `addAdapter` | Register that capability, equivalent to the convention directory |
| `addTool` / `addSkill` / `addAgent` / `addMcp` | Register AI capabilities (requires the AI features) |
| `addFeature(feature, name, definition)` | Generic registration; the shortcuts above are typed versions of it |

### metadata and requires

| Field | Purpose |
| --- | --- |
| `metadata.displayName` / `icon` / `order` | Name, icon and sort order on the Console plugin card; no runtime effect |
| `requires` | Resource tokens that must exist; startup refuses if any is missing |

### Framework resources (Host tokens)

All come from `zhin.js` except `httpHostToken` (from `@zhin.js/host-http`). A token is absent when its capability isn't configured, so `has()` before `use()`.

| Token | Available when | Main methods |
| --- | --- | --- |
| `databaseHostToken` | `database:` is configured | `define(name, columns)` defines this plugin's tables; `models.get(name)` reads/writes (`select` / `insert` / `update` / `delete` / `count`) |
| `scheduleHostToken` | Always | `register(job)` registers a 6-field cron (`sec min hour day month weekday`) and returns a cancel function; `list()` lists this plugin's jobs |
| `outboundHostToken` | An adapter is available | `send(input)` pushes a message and returns the platform message id or `null`; some platforms support `addReaction` / `removeReaction` / `recall` |
| `htmlRendererToken` | `@zhin.js/html-renderer` is installed | `render(html, { width, format, backgroundColor })` outputs PNG; fall back to plain text when missing |
| `runtimeEventPublisherToken` | Root plugin with Console enabled | `publish(type, data)` broadcasts to Console's live event stream |
| `httpHostToken` | The HTTP service is enabled | `route(method, path, handler, meta?)` registers HTTP routes; `ws(path).onConnection(cb)` registers WebSockets |

Database and schedule tokens expose only this plugin's private table names and job IDs — no raw connection, no process-level control. Full list: [Host Token reference](./host-tokens.md).

## Going deeper

### Config declaration details

::: details Expand
- The config root must be an object. With no fields you can omit `properties`; `{}` is valid too.
- `toJsonSchema()` exports standard JSON Schema; `toJSON()` is an internal serialization — they serve different purposes.
- `.secret()` exports `writeOnly: true` plus an `x-zhin-config.secret` hint and forbids defaults on secrets. It doesn't read environment variables or grant permissions.
- Descriptions, choices, hidden fields, component types and `.effect('reload')` all live on the same Schema; Console reads them from the runtime.
- The Console form supports basic nested objects, lists and dictionaries. `union`, `intersect`, `tuple` and `$ref` export standard validation, but full form editing isn't supported yet and Console reports an explicit error.
- Put union defaults on the union field: `Schema.union([...]).default(...)`. Defaults inside branches can't be disambiguated during validation and are rejected on export; `Schema.const(...)` as a direct option is fine. A default is checked against every structurally matching branch and rejected if any matching branch is a secret; Zhin doesn't infer branches from ranges, steps or choices and rejects conservatively when it can't rule one out.
- The entry file is loaded during config pre-check (without running `setup`), so keep the entry's top level declarative and put side effects in `setup`. Zhin copies and freezes Schema metadata at pre-check; later builder changes have no effect.
- `isolated` plugins can only use `schema.json`. A config change reloads only that plugin, and an invalid new config never replaces the old one.

Real examples: [repeater](https://github.com/zhinjs/zhin/blob/main/plugins/utils/repeater/src/config.ts) declares ranged defaults in one place; [short-url](https://github.com/zhinjs/zhin/blob/main/plugins/utils/short-url/plugin.ts) declares no business config and rejects unknown fields.
:::

### Resource lookup

`resources` is a parent-child chain: `use(token)` checks the current plugin, then each parent in turn, and throws `Missing resource` if nothing has it. Always `has()` before `use()` for optional capabilities.

### Hot-reload handoff

A hot reload is one atomic switch: the old version keeps serving until every preparation step of the new version has succeeded. If your resource **must connect successfully** before the switch is allowed, register it with `context.handoff.add`:

```ts
context.handoff.add({
  activateNext: (signal) => client.connect({ signal }), // called before the new version goes live; must honor cancellation
  deactivateNext: () => client.close(),                 // roll back if the switch fails
});
```

Internally Zhin calls each version a generation; see [Generation lifecycle](../concepts/generation-lifecycle.md).

### Custom shortcut methods

A custom Feature can declare its own shortcut name in its provider's `authoring.setupMethod` (must be `addXxx`), and Zhin installs it at runtime; the TypeScript type comes from that Feature's module augmentation of `PluginSetupContext`. There is no allowlist of shortcut names.

### The zhin field in package.json

Plugins and Feature packages declare their manifest in the top-level `zhin` field of `package.json`. It is strictly validated at startup; any invalid field throws `ManifestValidationError`.

```jsonc
{
  "zhin": {
    "protocol": 1,                    // required, always 1 for now
    "type": "plugin",                 // required: "plugin" | "feature"
    "entry": "./plugin.js",           // required: JS for published packages; a private local Root may use ./plugin.ts
    "engine": "^1.0.0",               // optional: required Zhin runtime version
    "runtime": "trusted",             // optional (plugin only): "trusted" (default) | "isolated"
    "platformFeatures": true,         // optional (plugin only): default true, Root gets the official Stable Features
    "features": [                     // optional (plugin only): Feature packages this plugin depends on
      { "package": "@zhin.js/command", "api": "^1.0.0", "optional": false }
    ],
    "plugins": [                      // optional (plugin only): mounted child plugin instances
      { "package": "@zhin.js/adapter-icqq", "instanceKey": "icqq" }
    ]
  }
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `protocol` | Yes | Manifest protocol version; must be `1` |
| `type` | Yes | `plugin` (a regular plugin that can mount children) or `feature` (a platform package providing a kind of capability) |
| `entry` | Yes | Entry file, package-relative, starting with `./` and without `..` |
| `engine` | No | A semver range; loading is refused if the runtime version doesn't satisfy it |
| `runtime` | No | `isolated` runs the plugin in an isolated environment: child plugins only, no Host Features, and an isolation adapter is required |
| `platformFeatures` | No | Default `true`: the Root plugin gets the official Stable Features even without declaring them |
| `features` | No | Feature packages depended on. `package` is an npm name or a `./` relative path; `api` is a range on its `featureApi`; `optional` allows degrading when missing |
| `plugins` | No | Mounted child plugins. `instanceKey` is **required**, matches `^[a-z0-9][a-z0-9-]*$` and is the config section key; mount the same package twice with different `instanceKey`s |

A `type: "feature"` package has only `protocol` / `type` / `entry` / `engine` / `featureApi`; `featureApi` declares the API version it implements, checked against consumers' `features[].api`.

### Development entry vs. npm entry

Local projects and private workspace plugins can set `zhin.entry` to `./plugin.ts` and run source directly with hot reload. Plugins published to npm must declare `./plugin.js` and include `plugin.js`, the generated JavaScript in convention directories, and `lib` in `files`:

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

Official plugins in this repo run `build-plugin-runtime-entries.mjs` in `prepack`: it compiles `plugin.ts` and convention-directory TypeScript into sibling JavaScript and rewrites imports of `src/` to `lib/`; after packing, `postpack --clean` removes those generated files. A normal `build` doesn't create them, so workspace tests and hot reload always use TypeScript source, while loading from `node_modules` uses the published JavaScript. Full release flow: [Complete plugin delivery](./plugin-delivery.md).

## Real examples

- [capabilities-bot](https://github.com/zhinjs/zhin/tree/main/examples/capabilities-bot): one `setup()` using the database, schedules, AI tools, proactive messaging and hot-reload handoff, each with a `has()` fallback.
- [lottery](https://github.com/zhinjs/zhin/tree/main/plugins/utils/lottery): database first with an in-memory fallback, a custom token to share services, tools in a convention directory, and a scheduled daily pipeline.

## Next steps

- [Convention directories](./conventions.md): which folder each capability goes in and how to name it.
- [Commands](./commands.md): params, options, permissions and help.
- [Module-level state](./module-state.md): which variables may live at module top level and which belong in `setup`.
