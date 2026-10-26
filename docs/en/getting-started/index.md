# Run your first Bot in 10 minutes

This page delivers one result: send `/hello` to a new Bot in the browser Sandbox and get a reply. No platform account or model key is required.

> Not sure what Zhin.js is for yet? Spend 5 minutes on [What is Zhin.js](./introduction.md) first.

## Before you start

- Node.js `>=22.19.0`, for scaffolded projects and the compiled IM library alike (`@zhin.js/ai` depends on undici 8, which needs it).
- pnpm 9 or newer.
- Access to [Remote Console](https://console.zhin.dev).

## 1. Create and start

```bash
npm create zhin-app my-bot -y
cd my-bot
pnpm dev
```

`-y` accepts every default: only the Sandbox adapter (a simulated chat window in the browser), the HTTP service Console needs, one `/hello` command, and no AI. Drop `-y` to pick a real platform, database or AI in the wizard — or add them later with `npx zhin setup`.

## 2. Verify in Console

The startup output prints the API Base. New projects currently use `http://127.0.0.1:8068`; always trust the terminal or `http.port` in `zhin.config.yml`.

1. Open [console.zhin.dev](https://console.zhin.dev).
2. Enter the API Base printed by the Host.
3. Use `HTTP_TOKEN` from the project `.env` file. When the project is created, the terminal shows only a masked token and where it is stored — never the full value — so it stays out of CI logs.
4. Open **Bot → Try a chat** (Sandbox) in the sidebar and send `/hello`.

A reply means the whole path works: Console reached the bot over HTTP → the Sandbox adapter received the message → it matched `commands/hello` → the reply went back through the same adapter. Connecting a real platform later just swaps Sandbox for that platform's adapter.

## 3. Know the generated project

To discover commands, send **`/菜单`** in the conversation (`菜单` if no command prefix is configured). It lists the root plugin's commands and child plugins; use `/菜单 <plugin-instance-key>` to browse children. Use `/hello --help` for a command's usage. The project-level `menuKeyword` setting can change the keyword; see [Browse loaded commands](../authoring/commands.md#browse-loaded-commands).

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

Two things are enough for now:

- **The `zhin` field in `package.json` says what is installed** (entry, child plugins); **`zhin.config.yml` says how it is configured** (port, credentials, plugin settings). Secrets go in `.env`.
- **Files in convention folders such as `commands/`, `components/` and `pages/` register themselves** — no manual registration in `plugin.ts`.

Full definitions: [Core concepts at a glance](./concepts.md).

## 4. Observe hot reload

Change the reply in `commands/hello/index.ts`, save it, and send `/hello` again — the new reply appears without a restart. Messages already being handled finish on the old code; if the new code has an error, the old version keeps working and the terminal prints the error.

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

<!--@include: ../../snippets/install-tiers.md#tiers-table-en-->

## Next steps

1. [Core concepts at a glance](./concepts.md): learn the recurring terms once.
2. [First plugin](./first-plugin.md): write a configurable `/ping` command.
3. [Adapters](../adapters/index.md): connect a real platform with `npx zhin setup --adapters`.
4. [AI overview](../ai/index.md): add an LLM with `npx zhin setup --ai`.
