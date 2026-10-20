---
title: "What is Zhin.js"
description: "One page on what Zhin.js solves, who it is for, what a bot is made of, and where to read next"
---

# What is Zhin.js

**Zhin.js is a TypeScript framework for building chat bots.** You write your bot logic once — commands, auto-replies, scheduled pushes, AI chat — and run it on QQ, WeChat, Discord, Telegram, Slack, DingTalk, Lark and 20+ other platforms at the same time.

The one-line difference from calling platform SDKs directly: **adapters absorb the platform differences, so your code only ever sees one kind of message.**

## What it is good for

| Scenario | Examples |
| --- | --- |
| Community / group bots | Check-ins, raffles, mini-games, keyword replies, welcome messages |
| Personal or team assistants | Reminders, calendars, RSS feeds, daily briefings |
| Multi-platform support / notifications | One codebase serving a QQ group, WeCom and Telegram together |
| AI chat assistants | Connect OpenAI / Ollama and let the model call tools you write |

It is **not** an in-editor coding agent like Cursor or Claude Code. Zhin's AI features exist to power bots that live on chat platforms.

## What a bot is made of

Keep this picture in mind — the rest of the docs zoom into one box at a time:

```text
  Chat platform                 Your project (a plugin)                       Chat platform
┌──────────┐   ┌─────────┐   ┌──────────────────────────────────┐   ┌─────────┐
│ QQ / WeCh│──▶│ Adapter │──▶│ Middleware → Command → (opt.) AI │──▶│ Adapter │──▶ reply
│ Discord… │   │         │   │   ↑ tools / components / schedules│   │         │
└──────────┘   └─────────┘   └──────────────────────────────────┘   └─────────┘
                                          ▲
                     Console (browser): logs, config, send test messages
```

| Part | What it is | What you do |
| --- | --- | --- |
| **Plugin** | Your project itself is a plugin; split into child plugins as it grows | Write `plugin.ts` and add a `zhin` field to `package.json` |
| **Command** | A function that runs when a user sends `/hello` | Write `defineCommand()` in `commands/hello/index.ts` |
| **Middleware** | An interceptor every message passes through — keyword replies, filters | Write `defineMiddleware()` in `middlewares/` |
| **Adapter** | An npm package that connects one platform, e.g. `@zhin.js/adapter-qq` | Pick it and fill in credentials with `npx zhin setup --adapters` |
| **AI Agent** (optional) | Messages that match no command go to an LLM, which can call your tools | Run `npx zhin setup --ai` and write tools in `tools/` |
| **Console** | A browser admin UI at [console.zhin.dev](https://console.zhin.dev) | Nothing to deploy — enter your bot's address and token |

Exact definitions live in [Core concepts at a glance](./concepts.md).

## Three design choices

1. **Small by default, add what you need.** The IM core alone is under 10MB. AI, image rendering and speech are separate packages. You can build and test everything without a model key.
2. **Capabilities are discovered from folders.** Drop a file in `commands/`, `middlewares/`, `tools/`… and it is registered — no long list of registration calls in your entry file.
3. **No restarts while you code.** Saving a file hot-reloads the bot. If the new code fails to load, the previous version keeps serving.

## Where to start

| You are | Read first | Then |
| --- | --- | --- |
| New here and want to see it run | [Quick start](./index.md) (10 minutes, no accounts or keys) | [Core concepts](./concepts.md) |
| Writing your own features | [First plugin](./first-plugin.md) | [Commands](../authoring/commands.md) · [Conventions](../authoring/conventions.md) |
| Connecting a real platform | [Adapters](../adapters/index.md) | [Configuration](../configuration/index.md) |
| Adding AI | [AI overview](../ai/index.md) | [AI Agent path](../paths/ai-agent.md) |
| Deploying to production | [Deployment and recovery](../operations/production.md) | [Troubleshooting](../troubleshooting/index.md) |
| Curious about internals or contributing | [Layered architecture](../concepts/architecture.md) | [Contributing](../contributing/development.md) |

Don't want to install anything yet? Try the [live demo](https://demo.zhin.dev).
