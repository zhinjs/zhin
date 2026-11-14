<p align="center">
  <a href="https://zhin.js.org">
    <img src="docs/public/logo.svg" alt="Zhin.js" width="120" height="120" />
  </a>
</p>

<h1 align="center">Zhin.js</h1>

<p align="center">
  <strong>Write once in TypeScript. Run your bot across 20+ chat platforms.</strong><br />
  File-based commands, cross-platform JSX cards, leak-free hot reload, and opt-in AI agents — managed from the browser.<br />
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
  <a href="./docs/en/authoring/define-plugin.md">Plugin Authoring</a> ·
  <a href="./docs/en/customer/index.md">Operator Guide</a> ·
  <a href="https://demo.zhin.dev">Live Demo</a> ·
  <a href="https://console.zhin.dev">Remote Console</a> ·
  <a href="./docs/contributing/development.md">Contributing</a>
</p>

---

> **Running a bot without writing code?** Jump to the [Operator & Group Admin Guide](./docs/en/customer/index.md) or try the [Live Demo](https://demo.zhin.dev). Building plugins or adapters in TypeScript? Start right below or browse [Plugin Authoring](./docs/en/authoring/define-plugin.md).

## 30-Second Quick Start

No platform account and no model key required (Node.js **≥22.19.0**, pnpm 9+):

```bash
npm create zhin-app my-bot -- -y --adapter sandbox
cd my-bot
pnpm dev          # zhin start --foreground: management gateway + your bot, hot reload
```

1. **Finish setup in the Console**: open the Console link printed in the terminal (`https://console.zhin.dev/?apiBaseUrl=…#token=…`; the bootstrap token after `#` never leaves your browser). Keep the default SQLite database and create the owner account.
2. **Chat with the Sandbox**: in the Console, open **Conversations → Sandbox** and send `/hello`. (The standalone page `http://127.0.0.1:8068/sandbox` works without signing in only before step 1; once the owner exists it needs a Console API token, issued under your user name → **Personal settings** (`/account`) and pasted into the box at the top right.)
3. **Run it in the background**: `npx zhin start` (then `zhin status`, `zhin logs -f`, `zhin stop`).

Full walkthrough: [Quick start](./docs/en/getting-started/index.md) · Something wrong? Run `npx zhin doctor`.

> [!IMPORTANT]
> **Upgrading an existing bot from 1.1.13 or earlier?** The Runtime now only accepts `configVersion: 2`. Stop the Bot first, upgrade `zhin.js` / `@zhin.js/cli` to the latest, then run `zhin migrate instances` (preview) and `zhin migrate instances --apply` (backs up first). Full steps and restore: [Upgrading to configVersion 2](./docs/en/operations/upgrades.md#configversion-2).
>
> **Upgrading from single-process `zhin runtime start`?** `zhin start` now runs a long-lived management gateway that supervises the bot; Console accounts replace `http.tokens`. Install `@zhin.js/gateway` with the same release of `zhin.js` / `@zhin.js/cli` and follow [Upgrading to the management gateway](./docs/en/migrations/management-gateway.md).

## Why Zhin.js?

Zhin.js is a TypeScript framework for **bots that live in chat apps** — community bots, personal assistants, notification and support bots, and governed AI chat assistants.

- **One codebase, 20+ platforms.** Adapters translate each platform into one unified message model. One bot can host multiple accounts across multiple platforms simultaneously.
- **A feature is a file.** Drop a file in `commands/`, `middlewares/`, `components/`, `schedules/`, or `tools/` and it registers automatically — zero wiring boilerplate.
- **Generation-isolated hot reload.** Save a file and Zhin atomically swaps in a new Generation. In-flight messages finish on the previous version; if new code throws on startup, the previous version keeps serving without downtime.
- **Small by default (<10MB), AI when you want it.** The IM core needs no LLM dependencies. Add AI agents, tools, 3-layer Markdown memory, and MCP anytime with `npx zhin setup --ai`.
- **Browser Console & Server-Driven Blueprints included.** Manage accounts, edit schema-driven forms, replay AI decisions, and trigger emergency stops from [console.zhin.dev](https://console.zhin.dev). Plugins author pure TypeScript `definePageBlueprint` pages (`pages/<name>/index.ts` — zero `.tsx`, zero `esbuild` bundling) that render in Web Console and project into IM cards (`projectBlueprintToImCard`) or CLI TUI panels (`projectBlueprintToCliPanel`).

> Zhin is **not** an in-editor coding agent (like Cursor or Claude Code). Its AI stack is purpose-built for chat platforms, group permissions, and multi-user conversations.

## Show, Don't Tell: 3 Killer Features

### 1. Command + Cross-Platform JSX Card & Interactive Button

Write interactive cards once in JSX (`commands/poll/index.tsx`). On platforms that support buttons, users click directly; on plain-text platforms, Zhin automatically degrades `<button>` into numbered text choices and routes the reply back to your `onClick` callback:

```tsx
// commands/poll/index.tsx  →  /poll "Release v1.2 today?"
import { defineCommand } from 'zhin.js/command'

export default defineCommand({
  description: 'Start a quick one-click poll',
  params: {
    topic: { type: 'text', default: 'Ship it today?' },
  },
  execute: ({ params }) => (
    <card title={`📊 ${params.topic}`}>
      <text>Click a button (or reply with its number on plain-text platforms):</text>
      <button label="👍 Yes" onClick={(msg) => `Recorded 👍 from ${msg.$sender.name}`} />
      <button label="🤔 Wait" onClick={(msg) => `Recorded 🤔 from ${msg.$sender.name}`} />
    </card>
  ),
})
```

### 2. Zero-Boilerplate AI Tool

Drop a file in `tools/<name>/index.ts` using `defineAgentTool` and `Schema.object(...)` from `zhin.js`. Framework security policies enforce permissions, visibility, and human approval before the model can invoke it:

```ts
// tools/weather/index.ts
import { Schema } from 'zhin.js'
import { defineAgentTool } from '@zhin.js/tool'

export default defineAgentTool<{ city: string }>({
  description: 'Get live weather for a city',
  parameters: Schema.object({
    city: Schema.string().required().description('City name, e.g. Shanghai'),
  }),
  requiresApproval: 'never',
  async execute({ city }) {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=3`)
    return res.text()
  },
})
```

### 3. Leak-Free Hot Reload & Multi-Platform `configVersion: 2`

Your project's `package.json#zhin.entry` points to `plugin.ts` (or `bot.ts` in single-file bots), while mounted adapters, child plugins, and per-instance settings all live cleanly in `zhin.config.yml`:

```yaml
# zhin.config.yml
configVersion: 2

http:
  host: 127.0.0.1
  port: 8068
  token: ${HTTP_TOKEN}

plugins:
  sandbox: '@zhin.js/adapter-sandbox'
  reminder: '@zhin.js/plugin-reminder'

sandbox:
  endpoints:
    - id: local-sandbox
      commandPrefix: /
```

## How a Bot is Put Together

```text
 chat platform        your project (a plugin)                         chat platform
 QQ / Discord … ──▶ Adapter ──▶ Middleware ──▶ Command ──────────────▶ Adapter ──▶ reply
                                                  │ no command matched
                                                  └──▶ AI Agent (optional) ──▶ Tools
```

| Part | What it is | Where it lives |
|------|------------|----------------|
| **Plugin** | Your project *is* the Root plugin; split into child plugins as it grows | Entry in `package.json#zhin.entry` (`plugin.ts`); child instances mounted in `zhin.config.yml` (`plugins:`) |
| **Command** | Runs when a user sends `/hello` or `/remind 10 break` | `commands/<name>/index.ts` |
| **Middleware** | Sees every message — keyword replies, rate limits, filters | `middlewares/<name>/index.ts` |
| **Adapter** | Connects one platform; one adapter can host many account `endpoints` | `@zhin.js/adapter-*`, configured in `zhin.config.yml` |
| **AI Agent** *(optional)* | Answers messages no command matched and calls your tools | `tools/<name>/index.ts`, enabled via `npx zhin setup --ai` |
| **Console** | Browser admin UI: toggle features per global → adapter → account → conversation, manage chat roles, send messages; plus accounts and permissions, the instance and its logs, terminal, audit log | [console.zhin.dev](https://console.zhin.dev), backed by the management gateway; local `/sandbox` for test chats |

```text
my-bot/
├── package.json      # "zhin" field: entry ("./plugin.ts") and capability features
├── zhin.config.yml   # configVersion: 2 — mounted plugins, platform endpoints, HTTP port
├── .env              # secrets: HTTP_TOKEN (bootstrap token), platform tokens, API keys
├── plugin.ts         # Root plugin entry: definePlugin()
├── commands/         # /commands — folder path = command name
├── middlewares/      # runs on every message
├── components/       # reusable JSX message cards
├── schedules/        # cron scheduled jobs
├── tools/            # functions the AI may call (optional)
└── pages/            # custom Console pages
```

Next: [Core concepts at a glance](./docs/en/getting-started/concepts.md) · [Write your first reusable plugin](./docs/en/getting-started/first-plugin.md) · [All convention folders](./docs/en/authoring/conventions.md) · [Commands in depth](./docs/en/authoring/commands.md)

## Connect a Real Platform

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

## Add AI (Optional)

```bash
npx zhin setup --ai   # pick a provider preset (OpenAI, DeepSeek, Qwen, Anthropic, Ollama…)
pnpm install && pnpm dev
```

The wizard installs `@zhin.js/agent` along with `@zhin.js/tool` and `@zhin.js/prompt-section`, enables AI in `zhin.config.yml`, and generates an `ai.plan.yml` (with API keys stored in `.env`) that is automatically seeded into the runtime catalog on first startup:

```yaml
# zhin.config.yml
ai:
  enabled: true
```

```yaml
# ai.plan.yml (generated by `npx zhin setup --ai`, seeded on first start)
version: 1
services:
  - id: openai
    label: OpenAI
    driver: openai
accounts:
  - id: openai-main
    label: OpenAI Default
    serviceId: openai
    authKind: api_key
    apiKey: ${OPENAI_API_KEY}
profiles:
  - id: default-chat
    label: Default Chat
    serviceId: openai
    accountId: openai-main
    model: gpt-4o-mini
defaults:
  chatProfileId: default-chat
```

Messages that match no command now go to the model — in DMs by default, in groups with an `ai:` prefix or `@mention`. Add files to `tools/` to give it new capabilities.

> Claude subscription and Antigravity are experimental channels: 实验 · 不受官方支持 · 可能违反供应商条款 · 风险由使用者自行承担 (experimental · not officially supported · may violate vendor terms · use at your own risk). See [AI providers](./docs/ai/providers.md).

Next: [AI overview](./docs/en/ai/index.md) · [Agent tools, Skills and Prompt Sections](./docs/en/authoring/agent-tools.md) · [AI Agent learning path](./docs/en/paths/ai-agent.md)

## Install Only What You Need

| Tier | Install | Adds |
|------|---------|------|
| **IM** (default) | `zhin.js` + `@zhin.js/cli` + an adapter; the CLI provides `zhin start` and the management gateway `@zhin.js/gateway`, needed in development and in production | Built-in commands, components, middleware, schedules, hot reload — **<10MB** |
| **AI** | `npx zhin setup --ai` (installs `@zhin.js/agent` and features) | Agent, sessions, memory, tools, compaction |
| **Provider** | `@ai-sdk/openai` etc. | Calls to a specific LLM vendor |
| **MCP** | `@modelcontextprotocol/sdk` | Use tools from external MCP servers |
| **Rich media** | `@zhin.js/html-renderer` | Render HTML / Markdown replies to images (falls back to text) |
| **Speech** | `@zhin.js/speech` | Speech-to-text in, text-to-speech out |

Detailed table and sizes: [Install tiers](./docs/en/getting-started/index.md#install-tiers). Since 1.1, `ZhinAgent` / `AIService` are imported from `zhin.js/agent` / `zhin.js/ai`, not from `zhin.js`.

## For Operators and Group Owners (No Code)

Once a bot is deployed, day-to-day operations happen in the browser Console ([console.zhin.dev](https://console.zhin.dev)). The Console talks to the project's **management gateway**: sign-in, permissions, starting and stopping the instance, dependency installs and the terminal are handled there, so the Console keeps working — sign-in, status, logs — while the bot instance is crashed or being upgraded.

**First visit**: use the setup link `zhin start` prints (or `HTTP_TOKEN` from `.env`) to create the first owner account. The bootstrap token stops working after that and everyone signs in with an account. On a server you can run `zhin console init` instead.

The Console is organized in four levels of objects — **global → adapter → account → conversation** — and every level has the same page layout:

| Section | What you see and do |
|---------|---------------------|
| Overview | Online state and statistics for this level |
| Features | Turn plugins on or off and override their settings at this level; a level switched off above is locked below, and every field shows which level it is inherited from ([layered config](./docs/en/console/features.md)) |
| Roles | Who is a chat `owner` / `admin` / `trusted` at this level (inherited downward, granted in the Console or in chat); platform owners and admins are a separate dimension and never become zhin roles ([chat roles](./docs/en/concepts/chat-roles.md)) |
| Records | Chat history, logs and change records for this level |

Account pages add **Connection** (sign-in, QR codes, connection checks); conversation pages add **Chat** (read history and send messages).

Administration:

- **Accounts and permissions**: Console users, built-in roles (`owner` / `admin` / `operator` / `viewer`) and custom roles, bound globally or to one adapter or account; API tokens for automation. Sign-ins, denied requests and every write go to the audit log. See [Access control](./docs/en/console/access-control.md).
- **Instance and operations**: the instance page shows status, restarts the bot and streams its logs; dependency installs and updates roll back on failure. Also the database, config file, environment variables, schedules, files, and an owner-only terminal (off by default). See [Operations](./docs/en/console/operations.md).
- **In-chat self-service**: with `features.selfService` on, people holding the zhin `admin` role (or higher) in a group manage it with the `feature` and `role` chat commands.
- **Three-dimension permissions**: commands, Agent tools and skills, middlewares and buttons are available based on the sender's zhin role, the sender's platform standing and the bot's own standing in the group — a mute tool, for example, needs `platform:admin` and `bot:admin`; each Agent turn only sees the tools that pass. See [chat roles](./docs/en/concepts/chat-roles.md).
- **Upgrading**: `master` is now `owner`; `master` / `trusted` / `ai.trigger.masters` in the config move into the database on first start and fail startup afterwards; permits such as `role(master)` and `scene_admin` are removed. See the [chat roles upgrade guide](./docs/en/migrations/chat-roles.md).
- **Guardrails & emergency stop**: approve AI-drafted announcements or risky moderation actions before they run, replay AI decisions, or mute/stop the bot with one click.

👉 Full guide: [Operator & Group Admin Guide](./docs/en/customer/index.md) · [Console path](./docs/en/paths/console.md) · [Solutions by outcome](./docs/en/solutions/index.md)

## Documentation Map

| I want to… | Start here |
|------------|------------|
| Understand what Zhin is | [What is Zhin.js](./docs/en/getting-started/introduction.md) · [Core concepts](./docs/en/getting-started/concepts.md) |
| Run a bot for the first time | [Quick start](./docs/en/getting-started/index.md) · [Examples](./docs/en/examples/index.md) |
| Write commands, cards & plugins | [First plugin](./docs/en/getting-started/first-plugin.md) · [definePlugin](./docs/en/authoring/define-plugin.md) · [Plugin delivery](./docs/en/authoring/plugin-delivery.md) |
| Connect platforms | [Adapters](./docs/en/adapters/index.md) · [Configuration](./docs/en/configuration/index.md) · [Localization](./docs/en/configuration/localization.md) |
| Add AI & tools | [AI overview](./docs/en/ai/index.md) · [Agent tools](./docs/en/authoring/agent-tools.md) · [Agent deep dive](./docs/en/ai/agent.md) |
| Deploy and operate | [Production](./docs/en/operations/production.md) · [Console](./docs/en/console/index.md) · [Troubleshooting](./docs/en/troubleshooting/index.md) |
| Understand the internals | [Architecture](./docs/en/concepts/architecture.md) · [Plugin model](./docs/en/concepts/plugin-model.md) · [Message flow](./docs/en/concepts/message-flow.md) · [Hot reload (Generations)](./docs/en/concepts/generation-lifecycle.md) |

Full site: [zhin.js.org](https://zhin.js.org) (Chinese by default; switch language in the top navigation).

## CLI Cheat Sheet

```bash
npx zhin start            # start the management gateway and the bot in the background (--foreground for dev, systemd, containers)
npx zhin status           # gateway and instance status (exit code 3 when not running)
npx zhin logs -f          # instance logs
npx zhin restart          # restart only the bot instance; the gateway and the Console stay up
npx zhin stop             # stop the gateway and the instance
npx zhin update           # update dependencies: stop instance → install → start, rolled back on failure
npx zhin console init     # create the first Console owner (same as the setup wizard in the browser)
npx zhin console user create alice --role viewer   # manage Console accounts; passwd / disable / enable / list
npx zhin service install  # install as a system service that starts on boot
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
| [`zhin.js`](./packages/im/zhin) | The main package — re-exports everything plugin authors need |
| [`create-zhin-app`](./packages/toolkit/create-zhin) | Project scaffolder (`npm create zhin-app`) |
| [`@zhin.js/cli`](./basic/cli) | The `zhin` command: run, set up, diagnose, migrate, publish |
| [`@zhin.js/gateway`](./packages/host/gateway) | Management gateway: HTTP, Console accounts and permissions, terminal, dependency transactions, instance supervision (comes with the CLI; list it in the project's dependencies so the lockfile pins one release) |
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
