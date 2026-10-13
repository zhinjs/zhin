---
title: Core concepts at a glance
description: Plain-language definitions of the terms used throughout the Zhin.js docs — plugin, convention directories, Feature, adapter, Endpoint, Host, Console, Agent, Generation
---

# Core concepts at a glance

The Zhin docs use a handful of terms over and over. This page explains each in a sentence or two, **when you need to care about it**, and where to read more. On a first pass, [the six you must know](#the-six-you-must-know) are enough.

## The six you must know

### Plugin

In Zhin, **every feature lives in a plugin, and your project is itself a plugin** (the Root plugin). A plugin is an ordinary npm package that:

- has a `zhin` field in `package.json` (the plugin manifest), and
- has an entry file `plugin.ts` that default-exports `definePlugin({ ... })`.

```ts
// plugin.ts
import { definePlugin } from 'zhin.js';

export default definePlugin({
  name: 'my-bot',
  setup(context) {
    // Optional startup work. The function you return runs on unload / hot reload.
  },
});
```

As the bot grows, split it into **child plugins** mounted in `package.json#zhin.plugins`. More: [Plugin model](../concepts/plugin-model.md) · [definePlugin overview](../authoring/define-plugin.md)

### Convention directories

**Put a file in a known folder and the capability registers itself** — no registration code in the entry. One folder per capability, the entry file is `index.ts`, and the folder path is the name:

| Put it here | You get | Author with |
| --- | --- | --- |
| `commands/hello/index.ts` | a `/hello` command | `defineCommand()` |
| `middlewares/<name>/index.ts` | middleware every message passes through | `defineMiddleware()` |
| `components/<name>/index.tsx` | a reusable message card (JSX) | `defineComponent()` |
| `handlers/<name>/index.ts` | platform event handling (joins, recalls…) | `defineHandler()` |
| `schedules/<name>/index.ts` | a scheduled job | `defineSchedule()` |
| `tools/<name>/index.ts` | a tool the AI can call | `defineAgentTool()` |
| `pages/<name>/index.tsx` | a custom page in Console | `definePage()` |

Small projects can skip folders and register in `setup({ addCommand })` instead — same result. Full list: [Convention directories](../authoring/conventions.md)

### Command

A function that runs when a user sends something like `/hello` or `/remind 10 drink water`. Params, options, permissions and `--help` are all declared in `defineCommand()`. The command prefix (default `/`) is configured per platform connection. More: [Commands](../authoring/commands.md)

### Adapter and Endpoint

- An **adapter** is an npm package that connects one platform, e.g. `@zhin.js/adapter-qq` or `@zhin.js/adapter-telegram`.
- An **Endpoint** is **one concrete account / connection** under an adapter. An adapter can host several Endpoints, so one bot can be logged into several QQ accounts at once.

For local development use the **Sandbox** adapter: a simulated chat window in the browser that needs no platform account. More: [Adapters](../adapters/index.md) · [Endpoint lifecycle](../authoring/endpoint-lifecycle.md)

### The two config files

The most common point of confusion: a Zhin project has **two** places for configuration, with different jobs.

| File | Answers | Typical contents |
| --- | --- | --- |
| `zhin` field in `package.json` | **What is installed** (structure) | entry file, which Features are used, which child plugins are mounted |
| `zhin.config.yml` | **How it is configured** (values) | HTTP port, platform credentials, AI models, per-plugin settings |
| `.env` | **Secrets** | tokens and API keys, referenced from yml as `${HTTP_TOKEN}` |

In `zhin.config.yml`, the Root plugin's settings go under `plugin:` and each child plugin's under `plugins.<instanceKey>:`. More: [Config as data](../concepts/config-as-data.md) · [Configuration](../configuration/index.md)

### Console

The browser admin UI, always at [console.zhin.dev](https://console.zhin.dev) — **you do not deploy it**. On startup the bot prints an API address (new projects default to `http://127.0.0.1:8068`). Enter that address and the `HTTP_TOKEN` from `.env` in Console to send test messages, read logs, edit config and manage plugins. More: [Console](../console/index.md)

## Once you start writing plugins

### Feature

**A capability package that scans one convention directory.** `@zhin.js/command` discovers `commands/`, `@zhin.js/tool` discovers `tools/`, and so on. A Feature takes effect when declared in `package.json#zhin.features`.

When your Root plugin depends on `zhin.js`, it inherits the common Stable Features automatically (adapters, commands, components, middleware, handlers, schedules), so most projects never write this by hand. Only the AI folders (`tools/`, `prompt-sections/`…) need extra declarations — `npx zhin setup --ai` writes them for you. More: [Plugin model · Plugin and Feature](../concepts/plugin-model.md)

### instanceKey (plugin instance)

The name you give a child plugin when mounting it, e.g. `{ "package": "./plugins/ping-pong", "instanceKey": "ping-pong" }`. It decides which section of `zhin.config.yml` the child reads. The same package can be mounted several times under different instanceKeys, each with its own config.

### Host

The HTTP server the bot process exposes. Console, webhook-style platform callbacks and MCP all reach the bot through it. The CLI assembles it during `zhin runtime start`; the port is `http.port` in `zhin.config.yml`. More: [Deployment and recovery](../operations/production.md)

### Message flow and outbound sending

Messages always travel one line: **platform → adapter → middleware → command (or the AI when nothing matches) → reply → adapter → platform**. To send messages from a plugin, use `message.$reply()` or the framework's send APIs — never call a platform SDK directly, or you bypass rendering, filtering and logging. More: [Message flow](../concepts/message-flow.md)

### Hot reload and Generations

When you save a file, Zhin re-assembles the whole plugin tree in the background (that assembled snapshot is a **Generation**). Once the new Generation validates, it is switched in atomically; **messages already in flight finish on the old version**, new messages use the new one. If the new code throws, the old version keeps serving.

The one rule for plugin authors: **anything you acquire in `setup()` (timers, connections) must be released in the cleanup function you return.** More: [Generation lifecycle](../concepts/generation-lifecycle.md) · [Module-level state](../authoring/module-state.md)

## Only when you use AI

| Term | In one sentence | More |
| --- | --- | --- |
| **Agent** | Takes over messages that match no command and answers with an LLM. Triggers by default in DMs; in groups use a prefix such as `ai:` or a mention | [AI overview](../ai/index.md) |
| **Provider** | Connection settings for a model service (OpenAI, Ollama…), under `ai.providers` | [AI overview](../ai/index.md) |
| **Tool** | A function the AI may call, e.g. weather lookup or a DB query. Permissions and approval are enforced by framework policy | [Agent tools](../authoring/agent-tools.md) |
| **Skill** | A `SKILL.md` playbook the AI loads only when needed — good for packaging a procedure | [Agent tools](../authoring/agent-tools.md) |
| **Prompt Section** | Background knowledge a plugin contributes to the AI (terms, rules). It changes context only and grants no permissions | [Agent tools](../authoring/agent-tools.md) |
| **MCP** | Two directions: let the AI use tools from external MCP servers, or expose your bot as an MCP server | [AI overview](../ai/index.md) |
| **Workroom** | Lets an Agent run multi-step, persistent, reviewable long tasks | [Governed business Agent](../solutions/governed-agent.md) |

## Next steps

- Haven't run it yet? [Quick start](./index.md)
- Build your first feature: [First plugin](./first-plugin.md)
- See the full layering and package structure: [Layered architecture](../concepts/architecture.md)
