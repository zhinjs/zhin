<p align="center">
  <a href="https://zhin.js.org">
    <img src="docs/public/logo.svg" alt="Zhin.js" width="120" height="120" />
  </a>
</p>

<h1 align="center">Zhin.js</h1>

<p align="center">
  <strong>One codebase. Every chat platform. TypeScript.</strong><br />
  Multi-channel · Opt-in AI · Remote Console
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
  <a href="https://zhin.js.org">Documentation</a> ·
  <a href="https://demo.zhin.dev">Live Demo</a> ·
  <a href="https://console.zhin.dev">Remote Console</a> ·
  <a href="./docs/contributing/development.md">Contributing</a>
</p>

---

Zhin.js is built for developers and teams shipping **serious bots / assistants on chat platforms** (DMs, groups, schedules, notifications, AI chat). It is **not** a Cursor / Claude Code–style coding agent.

- **Multi-channel** — one codebase on 20+ platforms (QQ / WeChat / Discord / Slack / DingTalk / Telegram…); one bot can run many accounts across many platforms
- **Opt-in AI** — default install is a &lt;10MB IM framework; add `@zhin.js/agent` for a full agent (tools / memory / orchestration / MCP)
- **Remote Console** — manage the bot in the browser: send messages, edit config, read logs, run schedules — no code required

```ts
// bot.ts — a whole bot can be this one file
import { defineCommand } from 'zhin.js/command'
import { definePlugin } from 'zhin.js/plugin-runtime'

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

## Quick Start

Three steps. No adapter boilerplate:

```bash
npm create zhin-app my-bot -y
cd my-bot
pnpm dev
```

Open [Remote Console](https://console.zhin.dev) → Host `http://127.0.0.1:8086` → send `/hello` in Sandbox. Done.

`-y` takes the IM golden path: Sandbox + Host + Console. **No model key required.**

| Path | Who | Time |
|------|-----|------|
| [**demo.zhin.dev**](https://demo.zhin.dev) | Zero install | Instant |
| `npm create zhin-app -y` | Standalone project (recommended) | ~1 min |
| [`examples/single-file-bot`](./examples/single-file-bot/) | “One `bot.ts` is the bot” | Clone, then `pnpm --filter single-file-bot dev` |
| [`examples/minimal-bot`](./examples/minimal-bot/) | Contributors / convention-dir template | Root `pnpm dev` |

More: [Getting started](./docs/getting-started/index.md) · [Examples](./docs/examples/index.md) · `npx zhin setup` · `npx zhin doctor`

**Requirements**: Node.js `^20.19.0` or `>=22.12.0` (Plugin Runtime examples: **≥22.6**), pnpm 9+

## Features

- **IM first** — commands, components, hot reload; `pnpm add zhin.js` **&lt;10MB**
- **Plugins** — file conventions + declarative APIs (`definePlugin` / `defineCommand` / `defineAdapter`)
- **Remote Console** — Host is API only; UI lives at [console.zhin.dev](https://console.zhin.dev)
- **Optional AI** — `@zhin.js/agent`: chat, tools, MCP, security policies
- **Multi-channel** — QQ / WeChat / Discord / Telegram / Slack / GitHub, see [adapters](./plugins/adapters)
- **File-based authoring** — `commands/`, `tools/`, `agent/skills` ([agent authoring](./docs/authoring/agent-tools.md))

### Built to stay operable

Zhin treats a bot as a long-running plugin system, rather than a collection of message callbacks:

- **Published plugins have a runtime contract** — the manifest declares protocol, engine range, Features, child plugins, isolation and instances; one package can be mounted more than once with separate scope and config ([plugin model](./docs/concepts/plugin-model.md)).
- **Hot reload is a Generation transaction** — the next plugin tree is prepared and validated off-path, then published atomically; a failed candidate leaves the active Generation serving traffic ([Generation lifecycle](./docs/concepts/generation-lifecycle.md)).
- **Configuration is owned data** — schemas compose across the plugin tree, each plugin receives its owner projection, and revisioned updates can roll back when activation fails ([config as data](./docs/concepts/config-as-data.md)).
- **Agent execution has one authority path** — Tool / Skill / MCP capabilities enter a fixed snapshot, while generation checks, permissions, approval, cancellation and journaling stay in the Turn runtime ([Agent runtime](./packages/im/agent/README.md)).
- **External Agent providers use the same governance** — the Advanced [Capability Seam](./docs/en/concepts/capability-seams.md) now projects Root services through `CapabilityIngress`; it does not expose a policy-free execute-by-name path.

<details>
<summary><strong>Stable / Advanced capability tiers</strong></summary>

| Tier | Feature | Notes |
|------|---------|-------|
| **Stable** | IM core | Sandbox + commands + Console |
| **Stable** | AI (optional) | `@zhin.js/agent` + provider |
| **Stable** | Plugins / HMR / TypeScript | Hooks API, full types |
| **Stable** | Security (baseline) | Bash allowlist, file policy, approval |
| **Advanced** | Multi-endpoint | IM / email / GitHub / webhook… |
| **Advanced** | Feature / MCP / toolSearch | Orchestration, deferred workers |

</details>

### Install tiers (zhin.js 4.x)

> **SSOT** (Chinese table): [`docs/snippets/install-tiers.md`](./docs/snippets/install-tiers.md) · site: [Install tiers](https://zhin.js.org/getting-started/#install-tierszhinjs-4x) · Chinese README: [`README.zh-CN.md`](./README.zh-CN.md)

| Tier | Install | ~production size | Capabilities |
|------|---------|------------------|--------------|
| **IM** | `pnpm add zhin.js` + an adapter (e.g. `@zhin.js/adapter-sandbox`); dev: `@zhin.js/cli` | **&lt;10MB** (library) | Plugin Runtime; command / component / adapter convention dirs (Stable Features inherited via `@zhin.js/core` `zhin.features`; Host is optional peer + `zhin.plugins`, see [ADR 0053](https://zhin.js.org/adr/0053-platform-stable-features)) |
| **AI** | `+ @zhin.js/agent zod ai` | +~12–15MB | ZhinAgent, sessions, tools, compaction |
| **Provider** | `+ @ai-sdk/openai` etc. | per vendor | LLM calls |
| **MCP** | `+ @modelcontextprotocol/sdk` | + a few MB | MCP client |
| **Rich media** | `+ @zhin.js/html-renderer` | + a few MB | outbound `html` / `markdown` → PNG (falls back to text if missing) |
| **Speech** | `+ @zhin.js/speech` | + a few MB | inbound STT, outbound TTS, `segment.tts` (warn + degrade if missing) |

Breaking (4.x): `import from 'zhin.js'` no longer includes `ZhinAgent` / `AIService`. Use `zhin.js/agent` or `zhin.js/ai`. See [ADR 0019](https://zhin.js.org/adr/0019-install-size-layering).

> **Windows**: [Getting started](./docs/getting-started/index.md).

## Enable AI (optional)

```bash
pnpm add @zhin.js/agent zod ai
pnpm add @ai-sdk/openai   # swap as needed
```

```yaml
# zhin.config.yml
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
  agent:
    execSecurity: allowlist
    execApprovalMode: ask
```

Deeper: [AI](./docs/ai/index.md) · [Agent security](./docs/ai/agent.md) · [Tools & skills](./docs/authoring/agent-tools.md)

## Adapters

| Platform | Package | Platform | Package |
|----------|---------|----------|---------|
| Sandbox (Stable) | `@zhin.js/adapter-sandbox` | QQ / ICQQ | `@zhin.js/adapter-icqq` |
| QQ official | `@zhin.js/adapter-qq` | NapCat | `@zhin.js/adapter-napcat` |
| OneBot 11 / 12 | `@zhin.js/adapter-onebot11` / `onebot12` | Discord | `@zhin.js/adapter-discord` |
| Telegram | `@zhin.js/adapter-telegram` | Slack | `@zhin.js/adapter-slack` |
| KOOK / DingTalk / Lark | `kook` / `dingtalk` / `lark` | GitHub | `@zhin.js/adapter-github` |
| Email / WeCom / LINE | `email` / `wecom` / `line` | Satori / WeChat MP | `satori` / `wechat-mp` |

Full list: [adapter docs](./docs/adapters/index.md) · [`plugins/adapters`](./plugins/adapters)

## Package Map

| Package | Role |
|---------|------|
| [`zhin.js`](./packages/im/zhin) | IM entry (4.x) |
| [`@zhin.js/core`](./packages/im/core) | Plugin / Adapter / Dispatcher |
| [`@zhin.js/ai`](./packages/im/ai) | AI engine (no IM) |
| [`@zhin.js/agent`](./packages/im/agent) | Agent orchestration & security |
| [`@zhin.js/cli`](./basic/cli) · [`create-zhin-app`](./packages/toolkit/create-zhin) | CLI / scaffold |

Layers and dependency direction: [architecture](./docs/concepts/architecture.md) · [repo structure](./docs/contributing/repo-structure.md)

## Documentation

| | |
|--|--|
| **Start** | [Getting started](./docs/getting-started/index.md) · [Roadmap & boundaries](./docs/index.md) · [Stability](./docs/concepts/generation-lifecycle.md) · [Docker](./docs/contributing/development.md) · [Windows](./docs/getting-started/index.md) |
| **Basics** | [Architecture](./docs/concepts/architecture.md) · [Config](./docs/configuration/index.md) · [Commands](./docs/authoring/commands.md) · [Plugins](./docs/concepts/plugin-model.md) |
| **Advanced** | [AI](./docs/ai/index.md) · [Agent authoring](./docs/authoring/agent-tools.md) · [Message flow](./docs/concepts/message-flow.md) |
| **Develop** | [Plugin authoring](./docs/authoring/define-plugin.md) · [Contributing](./docs/contributing/development.md) · [Architecture](./docs/concepts/architecture.md) |

Site: [zhin.js.org](https://zhin.js.org) · Chinese docs: [zhin.js.org](https://zhin.js.org) (switch language in the docs nav)

## CLI

```bash
pnpm dev                 # this repo defaults to minimal-bot; maintainers: pnpm dev:test
npx zhin new my-plugin   # plugin template
npx zhin setup           # incremental config wizard
npx zhin doctor          # environment diagnostics
npx zhin search <kw>     # search plugins
```

## Contributing

```bash
git clone https://github.com/zhinjs/zhin.git
cd zhin
pnpm install && pnpm build
cd examples/minimal-bot && pnpm dev
```

See [Contributing](./docs/contributing/development.md). Root `pnpm dev` points at the Stable convention-dir template `minimal-bot`. For “one file is the bot”, use `pnpm --filter single-file-bot dev`. Kitchen-sink: `pnpm dev:test` (`test-bot`) — **not** a user template.

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
