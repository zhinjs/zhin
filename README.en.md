<p align="center">
  <a href="https://zhin.js.org">
    <img src="docs/public/logo.svg" alt="Zhin.js" width="120" height="120" />
  </a>
</p>

<h1 align="center">Zhin.js</h1>

<p align="center">
  <strong>AI-native TypeScript bot framework</strong><br />
  One codebase. 20+ chat platforms. Opt-in AI agent.<br />
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
  <a href="https://zhin.js.org">Documentation</a> ·
  <a href="https://demo.zhin.dev">Live Demo</a> ·
  <a href="https://console.zhin.dev">Remote Console</a> ·
  <a href="./README.md">中文</a>
</p>

---

Zhin.js is built for developers and teams running **production chat bots and AI assistants** — not a coding agent like Cursor or Claude Code. Three core ideas:

- **Multi-platform** — One codebase runs on 20+ platforms (QQ, WeChat, Discord, Slack, Telegram, DingTalk, Lark, LINE, GitHub, Email…) with multi-account support
- **Opt-in AI** — Starts as a <10MB IM framework; install `@zhin.js/agent` to get a full AI agent with tools, memory, orchestration, MCP, and security policies
- **Remote Console** — Manage your bot from a browser: send messages, edit config, view logs, schedule tasks — no SSH needed

## Quick Start

```bash
npm create zhin-app my-bot -y
cd my-bot
pnpm dev
```

Open [Remote Console](https://console.zhin.dev) → set Host to `http://127.0.0.1:8086` → send `/hello` in Sandbox. Done.

**No API keys required. No platform accounts. Works out of the box.**

| Path | For whom | Time |
|------|----------|------|
| [**demo.zhin.dev**](https://demo.zhin.dev) | Zero-install playground | Instant |
| `npm create zhin-app -y` | New project (recommended) | ~1 min |
| [`examples/single-file-bot`](./examples/single-file-bot/) | See "one file = one bot" | Clone, then `pnpm --filter single-file-bot dev` |

**Requirements**: Node.js `^20.19.0` or `>=22.12.0`, pnpm 9+

## Why Zhin.js?

### vs. other bot frameworks

| | Zhin.js 5.x | Koishi 4.x | NoneBot 2.x |
|---|---|---|---|
| **Language** | TypeScript (ESM) | TypeScript | Python |
| **Core size** | <10MB | ~30MB+ | ~20MB+ |
| **AI Agent** | Built-in (tools, memory, MCP, A2A, security) | Third-party plugins | Third-party plugins |
| **Platforms** | 20+ adapters | 10+ | 10+ (OneBot-focused) |
| **Plugin system** | Convention dirs + `definePlugin()` | Registry-based | Decorators |
| **Hot reload** | File-level HMR | Full reload | Restart required |
| **Security** | 5-layer exec policy, file policy, network policy, audit | Basic permissions | Basic permissions |
| **MCP** | Client + Server (bidirectional) | No | No |
| **Architecture checks** | 32 automated harness scripts in CI | No | No |

### What you get

```
commands/hello.ts       → auto-registered command
middlewares/log.ts      → auto-registered middleware
tools/weather.ts        → AI tool, auto-discovered
agents/analyst.agent.md → specialist agent definition
skills/search/SKILL.md  → agent skill
```

Drop a file in the right folder. It works. Change it. It hot-reloads. No boilerplate.

## Platform Adapters

| Platform | Package | Platform | Package |
|----------|---------|----------|---------|
| Sandbox (built-in) | `@zhin.js/adapter-sandbox` | QQ (official) | `@zhin.js/adapter-qq` |
| Discord | `@zhin.js/adapter-discord` | Telegram | `@zhin.js/adapter-telegram` |
| Slack | `@zhin.js/adapter-slack` | LINE | `@zhin.js/adapter-line` |
| KOOK | `@zhin.js/adapter-kook` | DingTalk | `@zhin.js/adapter-dingtalk` |
| Lark (Feishu) | `@zhin.js/adapter-lark` | GitHub | `@zhin.js/adapter-github` |
| Email | `@zhin.js/adapter-email` | WeChat (MP) | `@zhin.js/adapter-wechat-mp` |
| WeCom | `@zhin.js/adapter-wecom` | OneBot 11/12 | `@zhin.js/adapter-onebot11` / `onebot12` |
| NapCat | `@zhin.js/adapter-napcat` | ICQQ | `@zhin.js/adapter-icqq` |
| Satori bridge | `@zhin.js/adapter-satori` | Milky | `@zhin.js/adapter-milky` |

## Enable AI (optional)

```bash
pnpm add @zhin.js/agent zod ai @ai-sdk/openai
```

```yaml
# zhin.config.yml
ai:
  providers:
    main:
      sdk: openai
      apiKey: ${AI_API_KEY}
  agents:
    zhin:
      provider: main
      model: gpt-4o
```

What `@zhin.js/agent` gives you:

- **Security policies** — 5-layer execution policy (deny → allowlist → approval → sandbox → full), file access policy, network domain whitelist, private IP blocking, audit logging
- **MCP** — Connect to external tool servers (client) and expose your bot's tools (server)
- **A2A** — Agent-to-Agent protocol; your bot can be called by other AI agents
- **Memory** — Persistent conversation memory with automatic compaction
- **Sub-agents** — Spawn specialist agents for complex tasks
- **6 providers** — OpenAI, Anthropic, DeepSeek, Google, Ollama, any OpenAI-compatible API

## Architecture

```
kernel (2.4k lines)     — PluginBase, Feature, Cron, Scheduler
    ↓
ai (14.5k lines)        — Provider abstraction, ModelRegistry, Memory, Compaction
    ↓
core (15.9k lines)      — Plugin, Adapter, Endpoint, Command, MessageDispatcher
    ↓
agent (56.5k lines)     — ZhinAgent, security policies, MCP client, orchestration
    ↓
zhin                    — Main entry point
```

Layer boundaries are enforced by automated checks — any import that violates the dependency direction fails CI.

| Package | Role |
|---------|------|
| [`zhin.js`](./packages/im/zhin) | IM entry point |
| [`@zhin.js/core`](./packages/im/core) | Plugin / Adapter / Dispatcher |
| [`@zhin.js/ai`](./packages/im/ai) | AI engine (no IM dependency) |
| [`@zhin.js/agent`](./packages/im/agent) | Agent orchestration & security |
| [`@zhin.js/cli`](./basic/cli) | CLI tools |

## Documentation

| | |
|--|--|
| **Getting started** | [Quick start](./docs/getting-started/index.md) · [Install tiers](./docs/snippets/install-tiers.md) |
| **Core concepts** | [Architecture](./docs/concepts/architecture.md) · [Plugin model](./docs/concepts/plugin-model.md) · [Message flow](./docs/concepts/message-flow.md) |
| **Authoring** | [definePlugin](./docs/authoring/define-plugin.md) · [Commands](./docs/authoring/commands.md) · [Agent tools](./docs/authoring/agent-tools.md) |
| **AI** | [AI module](./docs/ai/index.md) · [Agent security](./docs/ai/agent.md) |
| **Contributing** | [Development guide](./docs/contributing/development.md) · [Repo structure](./docs/contributing/repo-structure.md) |

Full docs: [zhin.js.org](https://zhin.js.org)

## Contributing

```bash
git clone https://github.com/zhinjs/zhin.git
cd zhin
pnpm install && pnpm build
pnpm dev
```

See [Contributing guide](./docs/contributing/development.md).

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
