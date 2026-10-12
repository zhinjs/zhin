# Writing Your First Plugin

Want to see "one file is enough" first? The repo's [single-file-bot](../examples/index.md#single-file-bot-one-bot-ts-is-a-bot) uses `setup({ addCommand })` to register commands with no `commands/` directory -- get it running, then come back to split files.

This tutorial adds a `ping-pong` **convention directory** plugin to an application already connected to Sandbox. For a new project, run `pnpm create zhin-app my-bot -y` and enter `my-bot`; repository contributors can use [minimal-bot](../examples/index.md#minimal-bot-stable-minimal-path).

Create four files under the application's `plugins/ping-pong/`, then mount the plugin in the host manifest. The configuration file belongs to the host; child plugins do not each need their own.

Source TypeScript projects require Node.js ≥22.12.0 and pnpm 9+; the CLI prepares TypeScript loading for `pnpm dev`. The compiled JavaScript library still supports Node.js `^20.19.0 || >=22.12.0`.

Final directory structure:

```text
ping-pong/
├── package.json      # zhin manifest (topology source of truth)
├── plugin.ts         # definePlugin entry point
├── schema.json       # Config contract (defaults + validation)
├── commands/
│   └── ping/
│       └── index.ts  # /ping command
└── zhin.config.yml   # Optional: only when the plugin itself is the application
```

## 1. package.json and the zhin manifest

```json
{
  "name": "ping-pong",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "zhin runtime start"
  },
  "dependencies": {
    "@zhin.js/command": "^1.1.0",
    "zhin.js": "^1.1.0"
  },
  "devDependencies": {
    "@zhin.js/cli": "^1.1.0"
  },
  "zhin": {
    "protocol": 1,
    "type": "plugin",
    "entry": "./plugin.ts",
    "engine": "^1.0.0",
    "runtime": "trusted",
    "features": [
      { "package": "@zhin.js/command", "api": "^1.0.0" }
    ],
    "plugins": []
  }
}
```

The `zhin` field is the plugin topology manifest:

| Field | Meaning |
|-------|---------|
| `entry` | Plugin entry file; must be a package-relative path starting with `./` |
| `runtime` | `trusted` (runs in the main process) |
| `features` | Child plugins explicitly declare the Features they use; this example mounts Command to discover `commands/`. Root applications depending on `zhin.js` inherit Stable Features by default, but this does not declare capabilities for their children |
| `plugins` | Mounted sub-plugin instances (empty in this example; see section 5 for mounting) |

## 2. plugin.ts

```ts
import { definePlugin } from 'zhin.js';

interface PingPongConfig {
  reply: string;
}

export default definePlugin<PingPongConfig>({
  name: 'ping-pong',
  // Console plugin card display
  metadata: { displayName: 'Ping Pong', icon: 'Blocks' },

  async setup(context) {
    // Config view: schema.json provides defaults, zhin.config.yml overrides
    const config = context.config.get();
    console.log(`[ping-pong] setup: reply=${config.reply}`);

    // Optional: return a Dispose callback, executed at generation end (hot-reload safe)
    return () => console.log('[ping-pong] disposed');
  },
});
```

## 3. commands/ping/index.ts

The Command Feature discovers `commands/**/index.ts`; the directory path determines the command name. Here the route is `ping`. Other files in that directory are helpers and do not register commands:

```ts
import { defineCommand } from 'zhin.js/command';

interface PingPongConfig {
  reply: string;
}

export default defineCommand<PingPongConfig>({
  description: 'Reply with the configured text',
  execute({ config }) {
    return config.reply;
  },
});
```

The command's `config` and the `context.config.get()` in `setup` share the same layered configuration.

## 4. schema.json and configuration

`schema.json` (JSON Schema 2020-12) declares the config contract and defaults:

Console forms support convertible field structures; `$ref`, `anyOf`, `oneOf`, `allOf`, and `prefixItems` are currently unsupported and produce explicit errors. Runtime JSON Schema configuration validation and Console form conversion are separate capabilities.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "reply": {
      "type": "string",
      "default": "pong",
      "description": "Reply content for the /ping command"
    }
  }
}
```

Configuration injection is **layered**: the Root plugin reads the `plugin:` section of `zhin.config.yml`;
sub-plugin instances read the `plugins.<instanceKey>` section.

## 5. Mounting to an application

### Method A: `./` local directory sub-plugin (recommended during development)

Install the local package's declared dependencies first. Installing `zhin.js` in the host does not automatically install the dependencies of an uninstalled local directory:

```bash
cd plugins/ping-pong
pnpm install
cd ../..
```

Reference it as a `./` relative path in the host application's `package.json#zhin.plugins` (no `..` traversal beyond the package root is allowed):

```json
{
  "zhin": {
    "plugins": [
      { "package": "./plugins/ping-pong", "instanceKey": "ping-pong" }
    ]
  }
}
```

Then pass configuration for this instance in the host's `zhin.config.yml`:

```yaml
plugins:
  ping-pong:
    reply: pong!
```

`instanceKey` rules: lowercase letters / digits / hyphens (`^[a-z0-9][a-z0-9-]*$`).

### Method B: Plugin as application

Place `zhin.config.yml` directly in the plugin directory -- the plugin itself becomes the Root. It still needs an adapter: a command-only plugin can assemble but cannot receive chat messages without a connected endpoint:

```yaml
# ping-pong/zhin.config.yml
plugin:
  reply: pong!

plugins: {}
```

```bash
cd plugins/ping-pong # from the host application directory
pnpm install
pnpm exec zhin setup --adapters  # Select an adapter such as Sandbox and add an Endpoint
pnpm install                   # Install the adapter dependencies added by setup
pnpm dev        # zhin runtime start
```

## 6. Startup and verification

```bash
pnpm dev
```

- The startup log should show `[ping-pong] setup: reply=pong!`
- Send `/ping` in the host's connected Sandbox or other channel; the bot replies `pong!` (`/` depends on that Endpoint's `commandPrefix` configuration)
- Editing `commands/ping/index.ts` or `zhin.config.yml` triggers hot reload -- no process restart needed
- `zhin runtime start --once` can be used for assembly smoke testing (non-interactive)

```mermaid
flowchart TD
  M[package.json#zhin manifest] --> R[Plugin Runtime]
  R --> F[Command Feature]
  F -->|discovers| C[commands/ping/index.ts]
  R --> E[plugin.ts setup]
  S[schema.json defaults] --> CFG[Layered config]
  Y[zhin.config.yml overrides] --> CFG
  CFG --> E
  CFG --> C
```

## Next steps

- [Examples at a glance](../examples/index.md): start with single-file-bot / minimal-bot, then explore database, schedules, Agent tools, and proactive outbound as needed
- For deeper plugin capabilities (Host Resources, lifecycle, handoff), see [Plugin model](../concepts/plugin-model.md)
