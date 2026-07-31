# Installation & Startup

First, verify your environment: Node.js `^20.19.0` or `>=22.12.0`, pnpm 9+.  
When running TypeScript directly with Plugin Runtime, `zhin runtime start` requires Node **>=22.6** (22.6--22.17: the CLI automatically adds `--experimental-strip-types`; **>=22.18 recommended**).

## How easy is it?

Shortest path: **scaffold -> start -> send a command in Console**. No platform adapter boilerplate, no model key required.

```bash
npm create zhin-app my-bot -y   # or pnpm create zhin-app my-bot -y
cd my-bot
pnpm dev
```

1. Open [console.zhin.dev](https://console.zhin.dev)
2. Fill in the Host address shown in the terminal (default `http://127.0.0.1:8086`) and the `HTTP_TOKEN` from `.env` (`-y` generates one)
3. Go to **Sandbox**, send `/hello`

`-y` skips the wizard and takes the **IM golden path** (Sandbox + Host + Remote Console). To choose adapters / databases / AI, remove `-y` to enter the interactive wizard (`@zhin.js/scaffold-wizard`).

Already have a project and want to add an adapter or AI:

```bash
npx zhin setup
```

## Want to see "one file is a bot"?

The repo example [single-file-bot](../examples/index.md#single-file-bot-一个-botts-就是机器人) puts commands inside `setup({ addCommand })` in `bot.ts`, with no `commands/` directory:

```bash
# pnpm install already ran at the repo root
pnpm --filter single-file-bot dev
```

Console -> Sandbox -> `/hello`. Full instructions in that directory's [README](https://github.com/zhinjs/zhin/tree/main/examples/single-file-bot).

## Four startup paths

From "one file" to "full application" in ascending complexity -- **one command**: `zhin runtime start`.

| Path | Form | Startup | Reference |
|------|------|---------|-----------|
| Single file | One `bot.ts` + `addCommand` / `addComponent`... | `zhin runtime start` | [single-file-bot](../examples/index.md#single-file-bot-一个-botts-就是机器人) |
| Single plugin | `plugin.ts` + convention directories (`commands/` etc.) | `zhin runtime start` | [minimal-bot](../examples/index.md#minimal-bot-stable-最小路径) |
| Plugin as application | Single plugin + `zhin.config.yml` (HTTP, database, sub-plugins) | `zhin runtime start` | [capabilities-bot](../examples/index.md#capabilities-bot-defineplugin-能力样板) |
| Full application | Multi-plugin workspace (adapters + feature plugins + AI) | `pnpm create zhin-app` -> `pnpm dev` | [full-bot](../examples/index.md#full-bot-l4-参考含-ai) |

```mermaid
flowchart LR
  subgraph Project directory
    P[bot.ts / plugin.ts<br/>definePlugin]
    C[commands/ components/ ...<br/>convention directories · optional]
    Y[zhin.config.yml<br/>optional]
    M[package.json#zhin<br/>topology manifest]
  end
  CLI[zhin runtime start] --> M
  M --> P
  M --> F[Feature providers<br/>adapter / command / component]
  F --> C
  Y -. injected per plugins.&lt;instanceKey&gt; .-> P
```

`package.json#zhin` is the single source of truth for topology: `entry`, `features`, `plugins`. `zhin.config.yml` holds only configuration values. Capabilities registered in `setup()` and those discovered from convention directories enter the same Feature projection -- if a single file is enough, write a single file; split into directories when you outgrow it.

### Common commands

```bash
zhin runtime start                          # Development mode (watch + hot reload)
zhin runtime start --mode production --no-watch   # Production mode
zhin runtime start --daemon                 # Background daemon (zhin stop to stop)
```

The `zhin` binary is provided by the dev dependency `@zhin.js/cli`.

## Install tiers (zhin.js 4.x)

```md
<<< ../snippets/install-tiers.md#tiers-table
```

## Next steps

- [Write your first plugin](./first-plugin.md): From an empty directory to a runnable plugin (or start with a single file)
- [Examples at a glance](../examples/index.md): How to run the official examples
- [definePlugin](../authoring/define-plugin.md): What else `setup` can do
