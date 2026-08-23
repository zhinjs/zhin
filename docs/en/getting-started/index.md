# Run your first Bot in 10 minutes

This page delivers one result: send `/hello` to a new Bot in the browser Sandbox and receive a reply from the real Runtime. No platform account or model key is required.

## Before you start

- Node.js `^20.19.0` or `>=22.12.0`; `>=22.18` is recommended for direct TypeScript execution.
- pnpm 9 or newer.
- Access to [Remote Console](https://console.zhin.dev).

## 1. Create and start

```bash
npm create zhin-app my-bot -y
cd my-bot
pnpm dev
```

`-y` creates the IM golden path with HTTP Host, Sandbox, Remote Console, and a `/hello` example. Remove `-y` when you want the wizard to configure a real platform, database, or AI.

## 2. Verify in Console

The startup output prints the API Base. New projects currently use `http://127.0.0.1:8068`; always trust the terminal or `http.port` in `zhin.config.yml`.

1. Open [console.zhin.dev](https://console.zhin.dev).
2. Enter the API Base printed by the Host.
3. Use `HTTP_TOKEN` from the project `.env` file.
4. Open Sandbox under **Conversations & Channels** and send `/hello`.

A reply proves the Console authentication, HTTP Host, Sandbox Endpoint, command discovery, and outbound reply path all work.

## 3. Know the generated project

```text
my-bot/
├── package.json          # Runtime topology: entry, features, plugins
├── zhin.config.yml       # Host and plugin configuration values
├── .env                  # token, platform credentials, model keys
├── plugin.ts             # root plugin entry
├── commands/             # file paths define command routes
├── components/           # reusable message components
└── pages/                # Console pages contributed by the plugin
```

`package.json#zhin` is the topology source of truth. `zhin.config.yml` stores values only. Convention files and capabilities registered in `setup()` enter the same generation projection.

## 4. Observe hot reload

Change the reply in `commands/hello.ts`, save it, and send `/hello` again. New requests use the new generation; an in-flight request keeps its original snapshot.

## Troubleshooting

```bash
npx zhin doctor
```

Doctor checks Node, pnpm, ports, `HTTP_TOKEN`, CORS, and the project manifest. When Console cannot connect, check the API Base printed by this project instead of assuming a default port.

## Choose the next outcome

| Need | Shape | Continue with |
| --- | --- | --- |
| Validate an idea | one `bot.ts` file | [Examples](../examples/) |
| Build commands and components | plugin + convention directories | [IM Bot path](../paths/im-bot.md) |
| Add models and tools | Agent Features | [AI Agent path](../paths/ai-agent.md) |
| Operate multiple accounts | HTTP Host + Remote Console | [Console path](../paths/console.md) |

## Install tiers

```md
<<< ../../snippets/install-tiers.md#tiers-table
```

Prefer an outcome over learning the package graph first: [Choose a solution](../solutions/).
