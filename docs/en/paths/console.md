---
title: "Console path: manage a running bot in the browser"
description: "Connect Console, find the right page for each task, inspect messages and AI runs, manage Workrooms, and diagnose problems in a fixed order"
---

# Console path: manage a running bot in the browser

Console is Zhin's web admin panel. Without signing in to the server, you can check whether the bot is online, send and receive messages, see each step the AI took, and track down errors.

When you're done you'll:

- know which page to open for each task;
- be able to trace a message to the AI's steps and logs;
- tell a read-only Demo token from a Full token that can make changes.

::: tip Console and the bot are separate
Console is a standalone web app ([console.zhin.dev](https://console.zhin.dev)); your bot process (the Host) only exposes token-protected APIs. One Console can therefore connect to bots on different machines.
:::

## 1. Connect the Host

1. Start the Bot and copy the API Base printed by the terminal.
2. Open [console.zhin.dev](https://console.zhin.dev).
3. Use `HTTP_TOKEN` from the project `.env` file.

Projects created by the scaffold default to port `8068`, but go by the terminal output or `http.port` in your config. If you can't connect, run `npx zhin doctor` first.

## 2. Choose a page by task

| Task | Page | Source of truth |
| --- | --- | --- |
| Judge system health | Dashboard | Endpoint, log, Agent, and action summaries |
| Send messages or handle requests | Conversations & Channels | Endpoints, sessions, messages, notices, requests |
| See how the AI handled a message | Agent Overview | each run's steps, tool results, cancel and retry actions |
| Manage multi-Agent projects | Workroom | tasks, assignments, reviews, and approval gates in a project |
| Confirm a command or tool is actually loaded | Runtime Capabilities | commands, middleware, components, Tools, Prompt Sections, MCP |
| Diagnose a failure | Logs | level, source, timeline, details |
| Change the system | Config, Environment, Files, Database | full-scope administration only |

**Configured doesn't mean active.** To know whether something is available, go by what **Runtime Capabilities** shows as currently loaded.

## 3. Send and receive messages

In **Conversations & Channels**, pick an Endpoint (one account the bot is signed in to on a platform) and a conversation to read and send messages. New messages arrive live; saved history is still there after a refresh.

::: details Why can't I see older history on some platforms?
The page receives live events over SSE and pulls history over HTTP; after a reconnect with a gap, it reloads the current conversation. If a platform's adapter has no history API, Console can only show what the bot saved itself while running.
:::

## 4. See what the AI did

**Agent Overview** lists every AI execution (a Run). Open one to see each model step, which tools were called with what results, and whether it was cancelled. You can also cancel a running task here or export a report of the run.

The workbench can also open lab sessions: choose a working directory and security policy when you start; the Host saves the session so it survives a refresh.

::: details How do I know which message a run belongs to?
Each run is uniquely identified by `runtimeId + turnId`; don't guess from time or message text. The tools, Prompt Sections, and MCP servers in use are fixed when a run starts, so saving code midway doesn't affect it.
:::

## 5. Manage Workrooms

A Workroom is a space where several Agents work on tasks together, bound to a group, channel, or GitHub repository; one bot account can serve several Workrooms. For the concept, see [Agent deep dive](../ai/agent.md#workroom-kernel).

- **Workroom Configuration**: create or edit a Workroom; changes apply on save with no restart. Member Agents must already be configured in `ai.agents`.
- **Board**: see the current state of tasks, assignments, reviewers, and approval gates.

::: details Where is the config stored? Can I change task state on the board?
Workroom configuration from Console is stored in the persistent Runtime Catalog and is **not** written back to `ai.workrooms` in `zhin.config.yml`. The board is a read-only view of the Workroom Journal (an event log); Console can't rewrite task state directly, and every change goes through an authenticated control interface.
:::

## 6. Full token vs Demo token

| | Full token | Demo token |
| --- | --- | --- |
| View status, capabilities, and runs | ✅ | ✅ |
| Send messages; change config, environment, files, database | ✅ (per Host policy) | ❌ |
| Read raw YAML config | ✅ | ❌ |

A token is a password: keep it out of URLs, screenshots, and public frontend config.

::: details Can't connect to a remote deployment?
Set `http.corsOrigins` to allow Console's origin. Behind a reverse proxy, forward the API, SSE, WebSocket, and page assets together; proxying ordinary HTTP alone breaks live messages or page loading. See [Production](../operations/production.md).
:::

## 7. When something breaks, check in this order

1. **Dashboard**: is the bot connected? Are the Endpoints online?
2. **Conversations & Channels**: did the user's message reach the bot?
3. **Runtime Capabilities**: is the command, tool, or Prompt Section loaded?
4. **Agent Overview**: which step did the AI reach, and how did it end?
5. **Logs**: filter to the same time window and source to find the error.

## Next steps

- [Console overview](../console/): how Console and the Host split work, and page extensions
- [Agent deep dive · Workroom Kernel](../ai/agent.md#workroom-kernel): Workroom rules and configuration
- [Community bot](../showcase/community-bot.md): a multi-platform production example
