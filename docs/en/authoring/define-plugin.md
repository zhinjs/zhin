---
title: "definePlugin"
description: "How to write a plugin entry: name it, declare config, use databases, schedules, proactive messages and AI tools in setup, and clean up correctly on hot reload"
---

# definePlugin: the plugin entry

A plugin's `plugin.ts` (if present) default-exports a `definePlugin({ ... })`. It does three things: **names the plugin**, **declares its config**, and **prepares runtime resources in `setup`** (database tables, scheduled jobs, proactive messaging…).

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

### Without plugin.ts {#entryless-plugin}

A plugin that only uses convention directories can omit `plugin.ts` altogether. The smallest plugin is two files:

```text
my-plugin/
├── package.json          # "zhin": { "protocol": 1, "type": "plugin" }: no entry, no features
└── commands/demo/index.ts
```

When `package.json#zhin` declares neither `entry` nor `exports["./zhin"]`, the runtime assembles the package as `export default definePlugin({ name })`: no `setup`, and convention directories are discovered from the **package root** as usual.

- **The plugin name** is the unscoped package name: `@scope/foo` → `foo`, `foo` → `foo`. Prefixes such as `zhin-plugin-` are not stripped.
- That name must still match `/^[a-z][a-z0-9-]*$/`. If it does not (for example `zhin.js-foo` contains a `.`), startup fails and tells you to add a `plugin.ts` with an explicit `name`.
- Put `displayName`, `displayNameI18n` and `icon` in `zhin.metadata`.
- A declared `entry` (or `exports["./zhin"]`) must exist; only omitting both makes an entry-less plugin. A `plugin.ts` on disk without a declared entry is not loaded, and `zhin plugin check` warns about it.
- Add a `plugin.ts` and declare `zhin.entry` once you need `setup`, inline `config`, `requires` or `capabilityGraph`.

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
- `definePlugin({ config: Schema.object(...) })` works out of the box for runtime validation and default values. If you also generate a `schema.json` with an identical structure for IDE or Console metadata, the runtime verifies their equivalence without throwing a conflict error (only mismatched schemas fail startup). See [Choose a config source](#choose-a-config-source) below.

#### Choose a config source {#choose-a-config-source}

| | `schema.json` (the `zhin new` template default) | Inline `config: Schema...` |
| --- | --- | --- |
| Use it when | You only need a JSON config contract; the plugin is `isolated`; the Schema should be readable without running plugin code | A trusted plugin wants `config.get()` typed automatically, or needs builders such as `.secret()`, `.component()` or `.effect('reload')` |
| How Zhin reads it | Reads the file at the package root | Loads the entry during config pre-check (without running `setup`) and calls `config.toJsonSchema()` |
| `isolated` plugins | The only option | Not allowed; the isolated process rejects it |

Coexistence rules:

- A trusted plugin can declare `definePlugin({ config: Schema.object(...) })` on its own. If it also includes an equivalent `schema.json` generated from the same Schema, the runtime verifies their equivalence and starts normally. If the two schemas diverge, config pre-check and startup fail, naming the entry file and the `schema.json` path.
- An `isolated` plugin's entry never runs in the host process, so the host reads only `schema.json`; a `config` in that entry throws inside the isolated process.

Plugins generated by `zhin new` ship with `schema.json` by default. When switching to inline `config`, you can either delete `schema.json` or keep it in sync.

More rules in [Config declaration details](#config-declaration-details) below.

#### Per adapter / endpoint / conversation overrides {#layered-config}

One plugin can use different settings on different adapter instances, accounts, groups and private chats ([ADR 0050](../../adr/0050-layered-feature-config.md), [ADR 0055](../../adr/0055-conversation-feature-config.md), [ADR 0057](../../adr/0057-config-storage.md)). Levels, top to bottom: `global` (the plugin's own block in the configuration file) < `adapter` (adapter instance alias, e.g. `qq`) < `endpoint` (`<alias>/<endpointId>`, e.g. `qq/bot-1`) < `conversation` (`<alias>/<endpointId>/<kind>:<conversation id>`, e.g. `qq/bot-1/group:123`); the three levels below global are stored in the project database table `feature_overrides`.

**1. Declare the supported levels on the schema root.** Omitting it means `["global"]`: global config only, and overrides may hold just the enable switch. A property can narrow its levels with the same keyword (for example, keep an API key global-only) but never widen the root; that fails at startup:

```json
{
  "type": "object",
  "x-zhin-config": { "levels": ["global", "adapter", "endpoint"] },
  "properties": {
    "maxItems": { "type": "integer", "minimum": 1, "default": 5 },
    "apiKey": { "type": "string", "x-zhin-config": { "levels": ["global"], "secret": true } }
  }
}
```

With an inline `config`, add the same `x-zhin-config.levels` to the root of what `toJsonSchema()` returns; with `Schema.object({...})`, call `.featureLevels(levels, { conversationFields, selfServiceFields, chatAdminFields })`, and narrow one property with `.fieldLevels(['global'])` (for example `Schema.string().secret().fieldLevels(['global'])`).

**Conversation level (ADR 0055).** `levels` may include `"conversation"`, which requires `"endpoint"` too. By default the conversation level is a switch only. List `conversationFields` on the root to allow field overrides there, and `selfServiceFields` (a subset of `conversationFields`) for what group admins may change in chat (`feature set …`). In chat, levels above the conversation also allow only `selfServiceFields` unless you widen them with `chatAdminFields`:

```json
{
  "type": "object",
  "x-zhin-config": {
    "levels": ["global", "adapter", "endpoint", "conversation"],
    "conversationFields": ["threshold", "cooldown"],
    "selfServiceFields": ["threshold"]
  },
  "properties": {
    "threshold": { "type": "integer", "minimum": 2, "default": 3 },
    "cooldown": { "type": "integer", "default": 30000 }
  }
}
```

- Listed fields must be the plugin's own properties whose `levels` allow the conversation level; otherwise startup fails.
- Plugins without a configuration schema still get the conversation switch, without field overrides.
- In keys, conversation ids escape `%` → `%25` and `/` → `%2F` and nothing else (ids may contain `:`), so a key has exactly two `/`.
- Conversation overrides, like the adapter and account levels, are not in the configuration file; see the next step.

**2. Overrides live in the project database and are written by the Console or the chat command.** Each override is a partial object of the plugin schema (only the fields its level allows) plus the enable switch. The Console feature page (`feature.set-override` / `feature.set-enabled` / `feature.remove-override`) or the in-chat command (`feature set / enable / disable <plugin> … [conversation|endpoint|adapter]`) writes them to the `feature_overrides` table, effective in place. A plugin block in the configuration file can no longer hold `overrides` (an existing project imports them into the database on its first start and removes them from the file, see [Upgrading: feature overrides move to the database](../migrations/feature-overrides.md)).

- Fields merge bottom-up: plain objects deep-merge key by key, arrays and scalars replace as a whole, and `null` means "explicitly cleared" (the field stops inheriting the upper value).
- Enabling is top-down: a level may only disable while every level above it is enabled; once an upper level disables the plugin, every level below is locked and can neither enable nor change its own switch (the Console answers 409 `locked`). A lower level never stores "enabled": enabling removes that level's switch. The global switch is still `disable_plugins` (changing it restarts the Host).
- Keys naming an undeclared adapter alias or account are kept with a warning, not an error, so you can write config before adding the account.
- Stored field patches are never environment-expanded (`${VAR}` stays literal), and chat cannot write such references.
- A plugin schema cannot declare its own `overrides` property (a reserved key), and a plugin's own `enabled` field is not overridable.
- Plugins without a config schema still get the three-level enable switch.
- With a MongoDB, Redis or memory project database the overrides cannot be saved and writes are refused.

**3. Read the effective config in code.** `context.config` stays the global view and never contains `overrides`:

```ts
setup(context) {
  const schedule = context.resources.use(scheduleHostToken);
  context.lifecycle.add(schedule.register({ id: 'push', cron: '0 */10 * * * *', async execute() {
    for (const target of targets) {
      // target is a message, { adapter: 'qq', endpointId: 'bot-1', conversation?: { kind: 'group', id: '123' } },
      // a conversation reference with its endpoint ({ conversation: target }) or a key 'qq/bot-1' / 'qq/bot-1/group:123'
      if (!context.isEnabledFor(target)) continue;
      const { maxItems } = context.configFor(target);
      // ...
    }
  } }));
}
```

`configFor(target)` returns the merged, frozen effective config, cached per configuration generation, override store version and resolution key (conversation included; any override write invalidates it), and always reflects the latest applied configuration. Changing an adapter / endpoint / conversation override or switch applies in place: no restart and no plugin reload, the next message sees the new value. Changing a global field keeps that field's own `x-zhin-config.effect`.

**Automatic gating:** when a plugin is disabled for an account or a conversation, its commands (and menu entries), middleware, message and event handlers that carry an endpoint, and Agent tool and skill disclosure are skipped for messages in that conversation, exactly as if the plugin did not exist (commands do not answer "disabled"). Scheduled jobs and background polling do not go through a message, so call `isEnabledFor` yourself as above.

The Console feature page reads and writes the global block and the three stored levels through the `feature.*` RPC (`feature.list` / `feature.matrix` / `feature.get` / `feature.set-override` / `feature.remove-override` / `feature.set-enabled` / `feature.conversations`). activity-feedback keeps its existing `platforms` / `endpoints`; new plugins should declare `x-zhin-config.levels` and use the layered overrides.

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
| `configFor(target)` / `isEnabledFor(target)` | Effective config and enable state on one adapter / account / conversation; see [Per adapter / endpoint / conversation overrides](#layered-config) |
| `resources` | Get and provide resources: `has(token)`, `use(token)`, `provide(token, value, dispose?)` |
| `lifecycle` | `lifecycle.add(dispose)` registers cleanups, run in reverse on hot reload or unload |
| `handoff` | Lets custom resources take part in the hot-reload switch; see "Hot-reload handoff" below |
| `addCommand` / `addComponent` / `addMiddleware` / `addHandler` / `addAdapter` | Register that capability, equivalent to the convention directory |
| `addTool` / `addSkill` / `addAgent` / `addMcp` | Register AI capabilities (requires the AI features) |
| `addFeature(feature, name, definition)` | Generic registration; the shortcuts above are typed versions of it |

### metadata, requires, and capabilityGraph (explicit capability graph)

| Field | Purpose |
| --- | --- |
| `metadata.displayName` / `icon` / `order` | Name, icon and sort order on the Console plugin card; no runtime effect |
| `metadata.displayNameI18n` | Name per Console interface locale, such as `{ 'zh-CN': '复读机', en: 'Repeater' }`; see [Language and localization](../configuration/localization.md#plugin-integration) |
| `requires` | Resource tokens that must exist; startup refuses if any is missing |
| `capabilityGraph` | Explicitly declares the plugin's capability graph via `definePluginCapabilityGraph({ provides, injects, features })` (provided tokens, injected tokens, and feature-grouped capabilities) for static governance and Console observability |

```ts
// plugin.ts
import { databaseHostToken, definePlugin, definePluginCapabilityGraph } from 'zhin.js';

export default definePlugin({
  name: 'my-plugin',
  metadata: { displayName: 'My Plugin', icon: 'Blocks' },
  capabilityGraph: definePluginCapabilityGraph({
    injects: [databaseHostToken],
    features: {
      commands: ['hello'],
      pages: ['index'],
      tools: ['weather'],
    },
  }),
});
```

### Framework resources (Host tokens)

All come from `zhin.js` except `httpHostToken` (from `@zhin.js/host-http`). A token is absent when its capability isn't configured, so `has()` before `use()`.

| Token | Available when | Main methods |
| --- | --- | --- |
| `databaseHostToken` | `database:` is configured | `define(name, columns)` defines this plugin's tables; `models.get(name)` reads/writes (`select` / `insert` / `update` / `delete` / `count`) |
| `scheduleHostToken` | Always | `register(job)` registers a 6-field cron (`sec min hour day month weekday`) and returns a cancel function; `list()` lists this plugin's jobs |
| `outboundHostToken` | An adapter is available | `send(input)` pushes a message and returns the platform message id or `null`; some platforms support `addReaction` / `removeReaction` / `recall` |
| `htmlRendererToken` | `@zhin.js/html-renderer` is installed | `render(html, { width, format, backgroundColor })` outputs PNG; fall back to plain text when missing |
| `runtimeEventPublisherToken` | Root plugin with Console enabled | `publish(type, data)` broadcasts to Console's live event stream |
| `httpHostToken` | The HTTP service is enabled | `route(method, path, (request, context) => Response, meta?)` registers HTTP routes (Web standard `Request` / `Response`, see [HTTP route contract](./host-tokens.md#http-route-contract)); `ws(path).onConnection(connection => …)` registers WebSockets |

Database and schedule tokens expose only this plugin's private table names and job IDs — no raw connection, no process-level control. Full list: [Host Token reference](./host-tokens.md).

## Going deeper

### Config declaration details

::: details Expand
- The config root must be an object. With no fields you can omit `properties`; `{}` is valid too.
- `toJsonSchema()` exports standard JSON Schema; `toJSON()` is an internal serialization — they serve different purposes.
- `.secret()` exports `writeOnly: true` plus an `x-zhin-config.secret` hint and forbids defaults on secrets. It doesn't read environment variables or grant permissions.
- Descriptions, choices, hidden fields, component types and `.effect('reload')` all live on the same Schema; Console reads them from the runtime. Declare the Chinese and English field titles and descriptions shown in the Console with `.i18n({ 'zh-CN': { title }, en: { title, description } })` (`x-i18n` in `schema.json`); see [Language and localization](../configuration/localization.md#plugin-integration).
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

Plugins and Feature packages declare their packaging contract in the top-level `zhin` field of `package.json` (`protocol`, `type`, `entry`, `features`, etc.). It is strictly validated at startup; any invalid field throws `ManifestValidationError`.

> Note: `package.json#zhin` only declares the plugin package's own contract — it does **not** mount plugin instances. Adapters (`icqq`), child plugins, and services are mounted in the host project's `zhin.config.yml` under `plugins:`.

```jsonc
{
  "zhin": {
    "protocol": 1,                    // required, always 1 for now
    "type": "plugin",                 // required: "plugin" | "feature"
    "entry": "./plugin.js",           // optional for plugins (entry-less plugin); JS for published packages; a private local Root may use ./plugin.ts
    "engine": "^1.0.0",               // optional: required Zhin runtime version
    "runtime": "trusted",             // optional (plugin only): "trusted" (default) | "isolated"
    "platformFeatures": true,         // optional (plugin only): default true, Root gets the official Stable Features
    "features": [                     // optional (plugin only): Feature packages this plugin depends on; inferred from convention directories when omitted
      { "package": "@zhin.js/command", "api": "^1.0.0", "optional": false }
    ]
  }
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `protocol` | Yes | Manifest protocol version; must be `1` |
| `type` | Yes | `plugin` (a regular plugin package) or `feature` (a platform package providing a kind of capability) |
| `entry` | Features: yes; plugins: no | Entry file, package-relative, starting with `./` and without `..`; when omitted, `exports["./zhin"]` is read (see below). A plugin that omits both is an [entry-less plugin](#entryless-plugin) |
| `engine` | No | A semver range; loading is refused if the runtime version doesn't satisfy it |
| `runtime` | No | `isolated` runs the plugin in an isolated environment: child plugins only, no Host Features, and an isolation adapter is required |
| `platformFeatures` | No | Default `true`: the Root plugin gets the official Stable Features even without declaring them |
| `features` | No | Feature packages depended on. `package` is an npm name or a `./` relative path; `api` is a range on its `featureApi`; `optional` allows degrading when missing. [Inferred from convention directories](#infer-features) when omitted |

A `type: "feature"` package has only `protocol` / `type` / `entry` / `engine` / `featureApi`; `featureApi` declares the API version it implements, checked against consumers' `features[].api`.

A plugin truly requires only two fields; the minimal manifest is `"zhin": { "protocol": 1, "type": "plugin" }`. The entry may be omitted ([entry-less plugin](#entryless-plugin)) and so may `features` (inferred, see below).

#### Inferring features from convention directories {#infer-features}

`zhin.features` may be omitted. The runtime then infers the Feature packages to mount from the convention directories present at the plugin package root:

| Directory | Feature package |
| --- | --- |
| `commands/` | `@zhin.js/command` |
| `components/` | `@zhin.js/component` |
| `middlewares/` | `@zhin.js/middleware` |
| `handlers/` | `@zhin.js/handler` |
| `schedules/` | `@zhin.js/schedule-feature` |
| `tools/` | `@zhin.js/tool` |
| `prompt-sections/` | `@zhin.js/prompt-section` |
| `hooks/` | `@zhin.js/hook-feature` |
| `mcps/` | `@zhin.js/mcp-feature` |
| `adapters/` | `@zhin.js/adapter` |
| `skills/` | `@zhin.js/skill` |
| `agents/` | `@zhin.js/agent-feature` |

The table exists once, in `@zhin.js/runtime` (`CONVENTION_FEATURE_PACKAGES`); `zhin plugin check`, `zhin create` and the repository checks all read it.

- **`features` omitted**: every directory present requires its Feature package. Inferred references carry no `api` range and accept the installed version; the package must still be listed in `dependencies` / `peerDependencies`. A missing one fails with `PackageResolutionError`, like a missing declared Feature, and the message names the directory that implied it.
- **`features` written** (even `[]`): the list is complete and nothing is inferred, exactly as before. Entries apply as written (`api` and `optional` kept); a directory the list does not cover does not mount its Feature (`zhin plugin check` warns).
- Stable Features the Root inherits from `zhin.js` / `@zhin.js/core` take precedence over inference; `platformFeatures` is unchanged.
- Plugins with `runtime: "isolated"` never infer (isolated plugins cannot mount Host Features).
- Write `features` explicitly to **pin an `api` range**, mark a Feature `optional`, or when the Feature comes from a package other than the one in the table (for example a local workspace Feature).
- A new kind of convention directory created while running is picked up the next time the manifest is read (edit `package.json` or restart).

### Declaring the entry with exports {#exports-zhin}

Instead of `zhin.entry` you can declare the runtime entry with the standard `exports["./zhin"]`. The `zhin` field is still required for zhin's own metadata such as `protocol` and `type`:

```jsonc
{
  "exports": {
    ".": { "types": "./lib/index.d.ts", "import": "./lib/index.js" },   // library API (optional)
    "./zhin": { "types": "./plugin.d.ts", "import": "./plugin.js" }     // runtime entry
  },
  "zhin": { "protocol": 1, "type": "plugin" }
}
```

Rules:

- A string `exports["./zhin"]` is used as is. A condition object is searched for `zhin`, then `import`, then `default` (nested conditions the same way); other conditions such as `types` or `require` are ignored. An array uses its first element that yields a path.
- The selected path is validated like `zhin.entry`: it starts with `./` and contains no `..`. The `.ts` / `.js` preference for local vs. `node_modules` packages is also the same (next section).
- **When both `zhin.entry` and `exports["./zhin"]` are present, `zhin.entry` wins.** `zhin.entry` remains fully supported and is not deprecated; use either form.
- To give the runtime a different file without affecting other tools, add a `zhin` condition: `{ "zhin": "./plugin.js", "import": "./lib/plugin.js" }`.

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
