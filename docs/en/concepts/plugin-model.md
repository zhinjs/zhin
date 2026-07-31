# Plugin Model

Connecting two QQ accounts to the same Bot, or splitting a game plugin out for independent publishing -- in zhin.js, both are solved with the same mechanism: the plugin tree. A plugin is an ordinary npm package; the only difference is an extra `zhin` field in `package.json`. The Root Plugin (your project) declares child plugins in `zhin.plugins`, and child plugins can in turn declare their own children. Like LEGO bricks: each one is independently formed and snaps into a designated position by instanceKey.

## The `zhin` Field in `package.json`

Using `examples/minimal-bot/package.json` as an example:

```json
{
  "name": "minimal-bot",
  "type": "module",
  "dependencies": {
    "zhin.js": "workspace:*"
  },
  "zhin": {
    "protocol": 1,
    "type": "plugin",
    "entry": "./plugin.ts",
    "engine": "^1.0.0",
    "runtime": "trusted",
    "features": [],
    "plugins": []
  }
}
```

The fields are strictly validated by `@zhin.js/runtime`'s manifest parser (`packages/im/runtime/src/manifest.ts`). Any invalid field throws a `ManifestValidationError` listing all issues.

| Field | Type | Description |
|-------|------|-------------|
| `protocol` | Must be `1` | Manifest protocol version |
| `type` | `"plugin"` or `"feature"` | See "Plugin vs. Feature" below |
| `entry` | String | Plugin entry point, must be a package-relative path starting with `./`, `..` escaping the package root is not allowed |
| `engine` | String, optional | Engine version constraint, e.g., `"^1.0.0"` |
| `runtime` | `"trusted"` or `"isolated"`, optional | Whether to load this plugin in an isolated runtime |
| `platformFeatures` | Boolean, optional | Default `true`; whether the Root inherits platform Stable Features (see "platformFeatures Inheritance" below) |
| `features` | Array | Feature capability packages this package depends on: `{ "package": "...", "api": "^1.0.0", "optional": false }` |
| `plugins` | Array | Child plugins mounted by this package: `{ "package": "...", "instanceKey": "...", "optional": false }` |

Packages with `type: "feature"` have fewer fields: `protocol` / `type` / `entry` / `engine` / `featureApi`. For example, `@zhin.js/adapter`:

```json
{
  "zhin": {
    "protocol": 1,
    "type": "feature",
    "entry": "./lib/provider.js",
    "engine": "^1.0.0",
    "featureApi": "1.0.0"
  }
}
```

Example projects are private workspaces, so they can use `plugin.ts` as the entry point directly and benefit from source-level HMR. Publishable npm plugins must declare `./plugin.js` and include that file along with the JavaScript build output from convention directories in the published package; the Runtime will not execute TypeScript entry points as published artifacts within `node_modules`. Official plugin builds are handled by `scripts/build-plugin-runtime-entries.mjs`.

## Plugin vs. Feature

- A **Plugin** is an assembly unit: it declares which Features it uses and which child plugins it mounts. Its entry point default-exports `definePlugin({...})` (`@zhin.js/plugin-runtime`).
- A **Feature** is a capability type: it defines "what a class of capabilities looks like" (contract + discovery convention + projection). `@zhin.js/adapter` defines the Adapter capability, `@zhin.js/command` defines the command capability, and so on.

After a plugin declares a dependency on a capability type via the `features` array, it can provide capability implementations following that Feature's conventions. For example, the sandbox adapter plugin (`@zhin.js/adapter-sandbox`) declares the `@zhin.js/adapter` capability and places a convention-based entry in the `adapters/` directory:

```ts
// plugins/adapters/sandbox/adapters/sandbox.ts
import { defineAdapter } from '@zhin.js/adapter';
import { messageGatewayToken } from '@zhin.js/core/runtime';
import { SandboxWsEndpoint } from '../src/endpoint.js';

export default defineAdapter({
  capabilities: ['inbound', 'outbound'],
  create(context) {
    return new SandboxWsEndpoint({
      gateway: context.use(messageGatewayToken),
      defaults: resolveSandboxEndpoint(context.config),
      // ...
    });
  },
});
```

## instanceKey: A Plugin's Name in the Tree

The same plugin package can be mounted multiple times (e.g., two QQ accounts using two instances of the same adapter package), distinguished by `instanceKey`. The naming rule is `/^[a-z0-9][a-z0-9-]*$/` (lowercase alphanumeric plus hyphens). It determines two things: the PluginId -- a child `sandbox` of `root` has the ID `root/sandbox`, with further nesting appended sequentially; and the configuration namespace -- the instance's configuration is written under `plugins.<instanceKey>` in `zhin.config.yml` (see [Config as Data](./config-as-data.md)).

```jsonc
// Root package.json
"plugins": [
  { "package": "@zhin.js/adapter-sandbox", "instanceKey": "sandbox" },
  { "package": "@zhin.js/adapter-icqq",   "instanceKey": "icqq" }
]
```

Duplicate `instanceKey` declarations are deduplicated: user-explicit declarations of the same key take priority over inherited default references.

## Two Sources for Child Plugins

`plugins[i].package` supports two formats (validation logic in manifest.ts):

1. **npm package name**: `"@zhin.js/adapter-icqq"`. The package must be a dependency of the current package.
2. **Local relative path**: `"./plugins/my-local-plugin"`. Starts with `./` and points to a directory within the package (a common pattern for private plugins in monorepos). `..` to escape the package root is not allowed.

`features[i].package` similarly supports both sources.

## Plugin as Root: Every Brick Can Run Independently

"Root Plugin" is not a special type -- any `type: "plugin"` package can be started independently as Root. In the package directory, run:

```bash
zhin runtime start
```

The CLI treats the current directory as the project root, scans its manifest tree, and starts up. This means: when developing a game plugin, you can start it directly in the plugin directory for testing, without first installing it into a Bot project. `examples/minimal-bot` is the minimal complete form of a Root Plugin.

## platformFeatures: The Four Inherited Capabilities of Root

`@zhin.js/core` declares four Stable Features in its own manifest:

```json
"features": [
  { "package": "@zhin.js/adapter",    "api": "^1.0.0" },
  { "package": "@zhin.js/command",    "api": "^1.0.0" },
  { "package": "@zhin.js/component",  "api": "^1.0.0" },
  { "package": "@zhin.js/middleware", "api": "^1.0.0" }
]
```

When the Root Plugin depends on `@zhin.js/core` (or depends on the `zhin.js` facade, which in turn depends on core), even if its own `features` array is empty, it **automatically inherits** these four Features -- adapter, command, component, and middleware are available out of the box. Merge rule: user-explicit declarations of the same package take priority (can be used to pin versions or override), and the rest are auto-filled.

Setting `"platformFeatures": false` in the Root's manifest disables this inheritance (e.g., for creating a Root that intentionally has no command system).

## Setup Context

The `PluginSetupContext` received by the plugin entry `definePlugin({ setup(context) {...} })`:

| Field | Description |
|-------|-------------|
| `plugin` | Instance view: id, instanceKey, parent, root, role (root/child) |
| `config` | `ConfigView`, `get()` returns configuration projected by this plugin's schema (see [Config as Data](./config-as-data.md)) |
| `resources` | This plugin's scoped resource Scope |
| `lifecycle` | `DisposeStack`: registered resources are automatically deregistered when the generation ends (see [Generation and Lifecycle](./generation-lifecycle.md)) |
| `handoff` | Entry point for participating in generation handoff |
| `addFeature` | Generic entry for declaring Capabilities within setup; corresponding Feature packages extend this with `addCommand` / `addComponent` / `addMiddleware` / `addAdapter` / `addAgent` / `addSkill` / `addTool` / `addMcp` |

`setup` can return a `Dispose` synchronously or asynchronously, or attach cleanup functions directly to `lifecycle`.
Registration in setup and discovery from convention directories feed into the same Feature projection; the former is suited for single-file Bots, while the latter is suited for
scaled organization and file-level granular HMR.
