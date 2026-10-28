<p align="center">
  <a href="https://zhin.js.org">
    <img src="docs/public/logo.svg" alt="Zhin.js" width="120" height="120" />
  </a>
</p>

<h1 align="center">Zhin.js</h1>

<p align="center">
  <strong>One bot for your groups on 20+ chat platforms.</strong><br />
  Operators run it from the browser — developers write it once in TypeScript.<br />
  QQ · WeChat · WeCom · DingTalk · Lark · Discord · Telegram · Slack · KOOK · LINE · …
</p>

<p align="center">
  <a href="https://github.com/zhinjs/zhin/actions/workflows/ci.yml"><img src="https://github.com/zhinjs/zhin/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/zhin.js"><img src="https://img.shields.io/npm/v/zhin.js.svg?color=cb3837" alt="npm" /></a>
  <a href="https://www.npmjs.com/package/zhin.js"><img src="https://img.shields.io/npm/dm/zhin.js.svg?color=cb3837" alt="npm downloads" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/zhin.js.svg?color=339933" alt="Node" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
  <a href="https://codecov.io/gh/zhinjs/zhin"><img src="https://codecov.io/gh/zhinjs/zhin/graph/badge.svg" alt="codecov" /></a>
  <a href="https://zhin.js.org"><img src="https://img.shields.io/badge/docs-zhin.js.org-0ea5e9" alt="Docs" /></a>
</p>

<p align="center">
  <b>English</b> ·
  <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://zhin.js.org/en/">Documentation</a> ·
  <a href="./docs/en/customer/index.md">Operator Guide</a> ·
  <a href="https://demo.zhin.dev">Live Demo</a> ·
  <a href="https://console.zhin.dev">Remote Console</a> ·
  <a href="https://github.com/zhinjs/zhin/wiki">Wiki</a> ·
  <a href="./docs/contributing/development.md">Contributing</a>
</p>

---

## Choose your path

Zhin serves two kinds of people. Pick yours — the rest of this README is split the same way.

| | 🧭 **Customer — operators & group owners** | 🛠 **Developer — plugin & adapter authors** |
|---|---|---|
| **You are** | A group owner, community operator or support lead. You run the bot; you don't write TypeScript. | Someone who writes commands, plugins, AI tools or platform adapters. |
| **You use** | The browser [Console](https://console.zhin.dev) and a config file | TypeScript, `create-zhin-app`, the `zhin` CLI |
| **You get** | Welcomes, check-ins, reminders, feed pushes, moderation, announcements that wait for approval, a one-switch emergency stop | One codebase on 20+ platforms, a feature is a file, hot reload that can't take you down |
| **Start here** | [Try the live demo](https://demo.zhin.dev) → [Operator & Group Admin Guide](./docs/en/customer/index.md) | [Developer quick start](#developer-quick-start) → [First plugin](./docs/en/getting-started/first-plugin.md) |

## What is Zhin.js?

Zhin.js is a framework for **bots that live in chat apps** — operators run them from a browser console, developers build them in TypeScript. Think community bots, personal assistants, notification and support bots, AI chat assistants.

- **One codebase, many platforms.** Adapters translate each platform into one unified message, so your commands and replies work everywhere. One bot can run many accounts on many platforms at once.
- **A feature is a file.** `commands/hello/index.ts` *is* the `/hello` command. Middleware, message cards, scheduled jobs and AI tools work the same way — no registration boilerplate.
- **Small by default, AI when you want it.** The IM core is under 10MB and needs no model key. Add LLMs, tools, memory and MCP with one command.
- **Hot reload that can't take you down.** Save a file and the bot reloads. If the new code fails, the previous version keeps serving.
- **Managed from the browser.** [console.zhin.dev](https://console.zhin.dev) lets you send test messages, read logs, edit config and manage plugins — nothing to deploy.

> Zhin is **not** an in-editor coding agent (like Cursor or Claude Code). Its AI features exist to power bots on chat platforms.

## For operators and group owners

You don't need to write code to run a Zhin bot well. Once a developer (or your ops person) has deployed it once, day-to-day work happens in the browser.

**Connect.** Open [console.zhin.dev](https://console.zhin.dev) and enter the bot's API address and token (`HTTP_TOKEN`). Use a read-only Demo token for colleagues who only watch. Not deployed yet? Try the [live demo](https://demo.zhin.dev) first.

| I want to… | In Console |
|------------|------------|
| See whether the bot and each account are online | Home |
| Read and send messages in any group | Chat accounts · Chat history |
| Install or switch off features (group suite, reminders, RSS, moderation…) | Feature store · Feature management |
| Change settings without editing files | Each plugin's config form; secrets under Advanced → environment variables |
| Welcome new members only in selected groups | Task center → start by use case ([guide](./docs/en/solutions/group-welcome.md)) |
| See why the AI replied or stayed silent | Bot status → decision replay |
| Make the bot go quiet *now* | Bot status → control plane: emergency stop / muted / read-only / mention only |

**Group ops with guardrails.** The AI can draft announcements but only a person with approval rights can send them; risky admin actions such as kicking a member become approval cards with a cooldown; every decision is traceable in decision replay.

**When to call a developer:** first deployment or server moves, a feature no existing plugin provides, a new platform, connecting the AI to your business systems, or errors in the run log you can't interpret.

👉 Full guide: [Operator & Group Admin Guide](./docs/en/customer/index.md) · [Console path](./docs/en/paths/console.md) · [Troubleshooting](./docs/en/troubleshooting/index.md)

## For developers

Everything below is for people writing plugins and adapters in TypeScript.

### Developer quick start

No platform account and no model key required.

```bash
npm create zhin-app my-bot -y
cd my-bot
pnpm dev
```

1. Open [console.zhin.dev](https://console.zhin.dev).
2. Enter the API address printed in the terminal (new projects use `http://127.0.0.1:8068`) and the `HTTP_TOKEN` from `.env`.
3. Open the **Sandbox** chat and send `/hello`. You should get a reply.

`-y` accepts every default: a browser **Sandbox** (simulated chat) instead of a real platform, and no AI. Requirements: Node.js **≥22.19.0** and pnpm 9+. Something wrong? Run `npx zhin doctor`.

Full walkthrough: [Quick start](./docs/en/getting-started/index.md) · Prefer not to install yet? Try the [live demo](https://demo.zhin.dev).

> [!IMPORTANT]
> **Upgrading an existing bot from 1.1.13 or earlier?** The Runtime now only accepts `configVersion: 2`. Stop the Bot first, upgrade `zhin.js` / `@zhin.js/cli` to the latest, then run `zhin migrate instances` (preview) and `zhin migrate instances --apply` (backs up first). Full steps and restore: [Upgrading to configVersion 2](./docs/en/operations/upgrades.md#configversion-2).

### How a bot is put together

```text
 chat platform        your project (a plugin)                         chat platform
 QQ / Discord … ──▶ Adapter ──▶ Middleware ──▶ Command ──────────────▶ Adapter ──▶ reply
                                                  │ no command matched
                                                  └──▶ AI Agent (optional) ──▶ Tools
```

| Part | What it is | Where it lives |
|------|------------|----------------|
| **Plugin** | Your project *is* a plugin; split it into child plugins as it grows | `plugin.ts` + the `zhin` field in `package.json` |
| **Command** | Runs when a user sends `/hello` | `commands/hello/index.ts` |
| **Middleware** | Sees every message — keyword replies, filters | `middlewares/<name>/index.ts` |
| **Adapter** | An npm package connecting one platform; one adapter can host many accounts | `@zhin.js/adapter-*`, configured in `zhin.config.yml` |
| **AI Agent** *(optional)* | Answers messages no command matched, and can call your tools | `tools/<name>/index.ts`, `ai:` in `zhin.config.yml` |
| **Console** | Browser admin UI for logs, config and test messages | [console.zhin.dev](https://console.zhin.dev) |

New to these terms? Read [Core concepts at a glance](./docs/en/getting-started/concepts.md) — it explains every word the docs use, in plain language.

### Writing features

A whole bot can be one file:

```ts
// bot.ts
import { definePlugin } from 'zhin.js'
import { defineCommand } from 'zhin.js/command'

export default definePlugin({
  name: 'my-bot',
  setup({ addCommand }) {
    addCommand('hello', defineCommand({
      description: 'Say hello',
      execute: () => 'Hello from Zhin!',
    }))
  },
})
```

As it grows, move each capability into its own file. The folder path is the name, and the file registers itself:

```ts
// commands/remind/index.ts  →  /remind 10 stretch
import { defineCommand } from 'zhin.js/command'

export default defineCommand({
  description: 'Create a reminder',
  params: {
    minutes: { type: 'integer', min: 1, max: 1440 },
    note: { type: 'text', default: 'Take a break' },
  },
  options: { quiet: { type: 'boolean', default: false } },   // --quiet
  execute: ({ params, options }) =>
    options.quiet ? 'OK' : `OK, I'll remind you in ${params.minutes} min: ${params.note}`,
})
```

```text
my-bot/
├── package.json      # "zhin" field: entry and child plugins (what is installed)
├── zhin.config.yml   # port, platform credentials, models (how it is configured)
├── .env              # secrets: HTTP_TOKEN, API keys
├── plugin.ts         # entry: definePlugin()
├── commands/         # /commands — folder path = command name
├── middlewares/      # runs on every message
├── components/       # reusable JSX message cards
├── schedules/        # scheduled jobs
├── tools/            # functions the AI may call (optional)
└── pages/            # custom Console pages
```

Next: [Write your first plugin](./docs/en/getting-started/first-plugin.md) · [All convention folders](./docs/en/authoring/conventions.md) · [Commands in depth](./docs/en/authoring/commands.md)

### Connect a real platform

```bash
npx zhin setup --adapters   # pick platforms, enter credentials
pnpm install && pnpm dev
```

| Platform | Package | Platform | Package |
|----------|---------|----------|---------|
| Sandbox (local testing) | `@zhin.js/adapter-sandbox` | QQ (ICQQ) | `@zhin.js/adapter-icqq` |
| QQ official bot | `@zhin.js/adapter-qq` | OneBot v11 / v12 | `@zhin.js/adapter-onebot11` / `onebot12` |
| Discord | `@zhin.js/adapter-discord` | Telegram | `@zhin.js/adapter-telegram` |
| Slack | `@zhin.js/adapter-slack` | KOOK | `@zhin.js/adapter-kook` |
| DingTalk | `@zhin.js/adapter-dingtalk` | Lark / Feishu | `@zhin.js/adapter-lark` |
| WeCom | `@zhin.js/adapter-wecom` | WeChat MP | `@zhin.js/adapter-wechat-mp` |
| LINE | `@zhin.js/adapter-line` | NapCat / Milky / Satori | `napcat` / `milky` / `satori` |
| Email | `@zhin.js/adapter-email` | GitHub | `@zhin.js/adapter-github` |

Each adapter has a maturity tier (Stable / Advanced / Experimental) and its own setup guide: [Adapters overview](./docs/en/adapters/index.md).

### Add AI (optional)

```bash
npx zhin setup --ai   # choose a provider (OpenAI, Ollama, …) and write the config
pnpm install && pnpm dev
```

The wizard installs the Agent runtime and the tool / prompt features, and writes something like this to `zhin.config.yml` (keys go to `.env`):

```yaml
ai:
  enabled: true
  providers:
    openai-main:
      sdk: openai
      apiKey: ${AI_API_KEY}
  agents:
    zhin:
      provider: openai-main
      model: gpt-4o-mini
```

Messages that match no command now go to the model — in DMs by default, in groups with an `ai:` prefix or a mention. Give it abilities by adding files to `tools/`; permissions, approvals and file/network access are enforced by framework policy, not by the prompt.

Next: [AI overview](./docs/en/ai/index.md) · [Agent tools, Skills and Prompt Sections](./docs/en/authoring/agent-tools.md) · [AI Agent learning path](./docs/en/paths/ai-agent.md)

### Install only what you need

| Tier | Install | Adds |
|------|---------|------|
| **IM** (default) | `zhin.js` + an adapter; `@zhin.js/cli` for dev | Plugins, commands, middleware, components, adapters, hot reload — **<10MB** |
| **AI** | `npx zhin setup --ai` (installs `@zhin.js/agent` and features) | Agent, sessions, memory, tools, compaction |
| **Provider** | `@ai-sdk/openai` etc. | Calls to a specific LLM vendor |
| **MCP** | `@modelcontextprotocol/sdk` | Use tools from external MCP servers |
| **Rich media** | `@zhin.js/html-renderer` | Render HTML / Markdown replies to images (falls back to text) |
| **Speech** | `@zhin.js/speech` | Speech-to-text in, text-to-speech out |

Detailed table and sizes: [Install tiers](./docs/en/getting-started/index.md#install-tiers). Since 1.1, `ZhinAgent` / `AIService` are imported from `zhin.js/agent` / `zhin.js/ai`, not from `zhin.js`.

## Documentation

**Operators & group owners**

| I want to… | Start here |
|------------|------------|
| Run the bot without code | [Operator & Group Admin Guide](./docs/en/customer/index.md) · [Live demo](https://demo.zhin.dev) |
| Manage it in the browser | [Console path](./docs/en/paths/console.md) · [Console reference](./docs/en/console/index.md) |
| Set up group welcomes, reminders, feeds | [Solutions by outcome](./docs/en/solutions/index.md) |
| Check why the bot didn't reply | [Find where a message stopped](./docs/en/troubleshooting/messages.md) |

**Developers**

| I want to… | Start here |
|------------|------------|
| Understand what Zhin is | [What is Zhin.js](./docs/en/getting-started/introduction.md) · [Core concepts](./docs/en/getting-started/concepts.md) |
| Run a bot for the first time | [Quick start](./docs/en/getting-started/index.md) · [Examples](./docs/en/examples/index.md) |
| Write plugins | [First plugin](./docs/en/getting-started/first-plugin.md) · [definePlugin](./docs/en/authoring/define-plugin.md) · [Plugin delivery (test & publish)](./docs/en/authoring/plugin-delivery.md) |
| Connect platforms | [Adapters](./docs/en/adapters/index.md) · [Configuration](./docs/en/configuration/index.md) |
| Use Chinese or English | [Project, personal and Console languages](./docs/en/configuration/localization.md) |
| Add AI | [AI overview](./docs/en/ai/index.md) · [Agent deep dive](./docs/en/ai/agent.md) |
| Deploy and operate | [Production](./docs/en/operations/production.md) · [Console](./docs/en/console/index.md) · [Troubleshooting](./docs/en/troubleshooting/index.md) |
| Understand the internals | [Architecture](./docs/en/concepts/architecture.md) · [Plugin model](./docs/en/concepts/plugin-model.md) · [Message flow](./docs/en/concepts/message-flow.md) · [Hot reload (Generations)](./docs/en/concepts/generation-lifecycle.md) |

Full site: [zhin.js.org](https://zhin.js.org) (Chinese by default; switch language in the nav).

## CLI cheat sheet

```bash
npx zhin setup            # add platforms, AI, database to an existing project
npx zhin doctor           # diagnose Node, ports, tokens, manifest
npx @zhin.js/cli new my-plugin --standalone  # scaffold a publishable plugin package
npx zhin search <keyword> # find community plugins
npx zhin install <name>   # install and mount a plugin
```

All commands: [CLI reference](./docs/en/cli/index.md).

## Packages

| Package | What it is |
|---------|------------|
| [`zhin.js`](./packages/im/zhin) | The package you install — re-exports everything plugin authors need |
| [`create-zhin-app`](./packages/toolkit/create-zhin) | Project scaffolder (`npm create zhin-app`) |
| [`@zhin.js/cli`](./basic/cli) | The `zhin` command: run, set up, diagnose, publish |
| [`@zhin.js/agent`](./packages/im/agent) | Optional AI Agent runtime with security policies |
| [`@zhin.js/adapter-*`](./plugins/adapters) | Platform adapters |
| [`plugins/`](./plugins) | Official plugins: games, reminders, RSS, calendar, moderation… |

How the layers fit together: [architecture](./docs/en/concepts/architecture.md) · [repo structure](./docs/contributing/repo-structure.md).

## Contributing

```bash
git clone https://github.com/zhinjs/zhin.git
cd zhin
pnpm install && pnpm build
pnpm dev                  # runs examples/minimal-bot
```

Other entry points: `pnpm --filter single-file-bot dev` (one-file bot) and `pnpm dev:test` (maintainers' kitchen-sink `test-bot`, not a template). See the [contributing guide](./docs/contributing/development.md) for checks, conventions and the release flow.

<p align="center">
  <a href="https://github.com/zhinjs/zhin/graphs/contributors">
    <img src="https://contributors-img.web.app/image?repo=zhinjs/zhin" alt="Contributors" />
  </a>
</p>

<p align="center">
  <img src="https://repobeats.axiom.co/api/embed/26e79889b3756142f3145cd72ae19830e6b4c06a.svg" alt="Repobeats" />
</p>

## License

[MIT](./LICENSE)
