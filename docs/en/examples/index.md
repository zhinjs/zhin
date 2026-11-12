---
title: "Example projects"
description: "Runnable examples that ship with the repo, from a one-file bot to a full project with AI. Pick one by what you want to learn and run it"
---

# Example projects

The fastest way to read Zhin code is to run a working example. The repo's `examples/` directory holds official examples that go from simple to complete; run `pnpm install` at the repo root and each one starts directly.

| Example | Look here to see… | Start | Try it in |
|------|------|------|------|
| [single-file-bot](#single-file-bot-one-bot-ts-is-a-bot) | The shortest possible bot: a single `bot.ts` | `pnpm --filter single-file-bot dev` | Console Sandbox |
| [minimal-bot](#minimal-bot-the-smallest-convention-directory-project) | The smallest project using convention directories, no AI | `pnpm dev` at repo root | Terminal |
| [capabilities-bot](#capabilities-bot-common-capabilities-in-one-plugin) | How one plugin uses config, database, schedules, and tools | `pnpm --filter capabilities-bot dev` | Console Sandbox |
| [full-bot](#full-bot-a-complete-reference-with-ai) | A complete project with AI, semantic memory, and MCP | `pnpm dev:full` | Sandbox, NapCat, KOOK |
| [test-bot](#test-bot-for-maintainer-regression) | Maintainer multi-platform regression only; not a template | `pnpm dev:test` | 20+ platforms |

We suggest reading them in the order **single-file-bot → minimal-bot → capabilities-bot → full-bot**.

::: tip Just want your own project?
No need to clone the repo: run `npm create zhin-app my-bot -y`. See [Quick start](../getting-started/index.md).
:::

::: info How the examples start and how to sign in to the Console
Except for minimal-bot, an example's `pnpm dev` is `zhin start --foreground --watch source config`: the management gateway runs in the foreground and launches and hot-reloads the bot instance; `pnpm start` is the production `zhin start --foreground --mode production --no-watch`.

The first time the Console connects to an example, its database has no owner yet: use the example's bootstrap token (`http.token`, given below) to finish the setup wizard and create the owner account, then sign in with that account; the bootstrap token stops working at once. You can also run `pnpm exec zhin console init` in the example directory. See [Console setup and onboarding](../console/onboarding.md).
:::

## single-file-bot: One bot.ts Is a Bot

No `commands/` or other directories: register commands directly in the plugin entry's `setup({ addCommand })`. Good for demos, one-off scripts, or showing someone how short startup can be.

```bash
pnpm --filter single-file-bot dev
```

Open [Console](https://console.zhin.dev) and set API Base to `http://127.0.0.1:8086`. This example sets no `http.token` and the Host listens on loopback only, so the Console goes straight to the setup wizard; create the owner account, then send **`/hello`** in Sandbox.

```text
single-file-bot/
├── bot.ts              # definePlugin + addCommand('hello')
├── package.json        # zhin.entry -> ./bot.ts; plugins -> sandbox
└── zhin.config.yml     # sandbox commandPrefix: '/'
```

Commands registered with `addCommand` go into the same command table as discovered ones and behave identically. When the bot grows, split it into convention directories (see minimal-bot below). Details are in that directory's [README](https://github.com/zhinjs/zhin/tree/main/examples/single-file-bot).

## minimal-bot: the smallest convention-directory project

One `plugin.ts` entry plus `adapters/`, `commands/`, and `components/`, chatting right in your terminal. Adapters, commands, and components are built into the framework, so nothing extra goes in `package.json#zhin`.

```bash
# At the repo root
pnpm install
pnpm dev            # = pnpm --filter minimal-bot dev
```

Its `dev` is `zhin start --foreground --watch source config`: the gateway runs in the foreground and, when stdin is a terminal, hands it to the supervised instance so the terminal adapter can read your input (a background `zhin start` has no terminal input). When the `zhin> ` prompt appears, type `/hello`, or `/card` to see a rendered status card image, in the same terminal. Editing files in those directories hot-reloads them; `Ctrl+C` exits.

```text
minimal-bot/
├── plugin.ts                 # definePlugin() entry
├── schema.json               # config fields
├── zhin.config.yml           # config
├── adapters/terminal/index.ts      # terminal adapter: stdin/stdout
├── commands/hello/index.ts         # /hello
├── commands/card/index.ts          # /card -> renders a component
└── components/status-card/index.ts # status card component
```

::: details Node.js version
Requires Node.js >=22.19, which runs TypeScript natively.
:::

## capabilities-bot: common capabilities in one plugin

**One plugin plus one `zhin.config.yml`** is enough to start. A single `setup()` demonstrates the common capabilities: reading config, creating a database table, scheduled jobs, an Agent tool (skipped automatically when AI isn't installed), proactive messages, cleanup when the plugin stops, a card on the Console plugins page, and mounting a sub-plugin from an npm package (`@zhin.js/adapter-sandbox`).

```bash
cd examples/capabilities-bot
pnpm dev            # zhin start --foreground --watch source config
```

After startup:

- connect the Console to `http://127.0.0.1:18099`; the first time, create the owner account with the bootstrap token `capabilities-dev-token`, then sign in with the account; the plugins page shows a `Capabilities Bot` card;
- the `whoami` and `stats` commands are available (the latter demonstrates a database counter);
- a heartbeat job logs a line every 5 minutes.

The directory's `README.md` maps each capability to its code.

## full-bot: a complete reference with AI

Adds the full AI stack on top of convention directories: `@zhin.js/agent`, semantic memory, MCP, and A2A multi-Agent networking, plus the Sandbox, NapCat, and KOOK platforms and Skill / Tool / Page extensions.

```bash
# First run pnpm install && pnpm build at the repo root
cd examples/full-bot
cp .env.example .env    # fill in your model service key and HTTP_TOKEN (the Console bootstrap token)
pnpm dev                # or pnpm dev:full at the repo root
```

- The Host defaults to `http://127.0.0.1:8069`; the first time you connect the Console, create the owner account with `HTTP_TOKEN` from `.env`, then sign in with the account;
- the acceptance checklist and NapCat / KOOK live steps are in that directory's `ACCEPTANCE.md`.

## test-bot: for maintainer regression

::: warning Not a starter template
Don't copy it as the start of a new project. Use `npm create zhin-app`, [single-file-bot](#single-file-bot-one-bot-ts-is-a-bot), or [minimal-bot](#minimal-bot-the-smallest-convention-directory-project) instead.
:::

It mounts 20+ platform adapters (Sandbox, ICQQ x5, QQ Official, Slack, Discord, Telegram, KOOK, DingTalk, Lark, WeCom, LINE, Email, GitHub…) and every feature plugin (game center, lottery, group-suite, rss, code-runner, and more) for maintainers' multi-platform regression testing.

```bash
pnpm install && pnpm build   # at the repo root
pnpm dev:test                # or cd examples/test-bot && pnpm dev
```

- Requires Node.js >=22.19; credentials come from that directory's `.env` (template in `.env.example`);
- in Console, set API Base to `http://127.0.0.1:8086`; the first time, create the owner account with the bootstrap token `test-bot-dev-token`, then sign in with the account;
- to run in the background: `pnpm daemon` (that is, `zhin start --mode production --no-watch`, the gateway in the background); check it with `zhin status` / `zhin logs -f` and stop it with `pnpm stop`.

## Next steps

- [Quick start](../getting-started/index.md): create your own project with the scaffold
- [Write your first plugin](../getting-started/first-plugin.md): write a configurable command from scratch
- [Showcase](../showcase/index.md): see how others run Zhin in production
