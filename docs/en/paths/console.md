# Operate a running Zhin with Console

Goal: confirm the current generation, handle messages, diagnose failures, and observe Agent or Workroom state without signing in to the server.

Console is a separate Web app. The Host provides token-protected API, SSE, and Sandbox endpoints.

## Done means

- You can distinguish desired configuration from active runtime state.
- You can trace an Endpoint message through Agent steps and logs.
- Persisted sessions and Workroom Tasks survive a page refresh.
- Demo tokens remain read-only; full tokens can perform allowed administration.

## 1. Connect the Host

1. Start the Bot and copy the API Base printed by the terminal.
2. Open [console.zhin.dev](https://console.zhin.dev).
3. Use `HTTP_TOKEN` from the project `.env` file.

New projects currently use port `8068`, but Console should always follow terminal output or `http.port`. Run `npx zhin doctor` when the connection fails.

## 2. Choose a page by task

| Task | Page | Source of truth |
| --- | --- | --- |
| Judge system health | Dashboard | Endpoint, log, Agent, and action summaries |
| Send messages or handle requests | Conversations & Channels | Endpoints, sessions, messages, notices, requests |
| Observe one Agent execution | Agent Overview | runs, steps, Tool results, cancel and retry actions |
| Operate collaboration projects | Workroom | Project-scoped runs, Tasks, Assignments, Gates |
| Check active capabilities | Runtime Capabilities | commands, middleware, components, Tools, Prompt Sections, MCP |
| Diagnose a failure | Logs | level, source, timeline, details |
| Change the system | Config, Environment, Files, Database | full-scope administration only |

Do not infer that a configured capability is active. Use the generation projection in **Runtime Capabilities** and the concrete Run.

## 3. Verify live events and history recovery

**Conversations & Channels** receives incremental events through SSE and pulls authoritative history through HTTP RPC. On a recovery gap, Console discards the incremental projection and reloads the current Endpoint and Channel.

Refreshing should not lose messages persisted by the Host. If an Adapter cannot provide history, Console can show only the portion already persisted in the Host inbox.

## 4. Use the Agent workbench

An Agent Run is identified by `runtimeId + turnId`; time and message text are not reliable identity. The workbench shows model steps, Tool calls, cancellation terminal state, and portable reports.

Lab sessions are persisted by the Host. A task can specify its working directory and security policy. Prompt Sections, Tools, and MCP still come from the fixed generation snapshot for that turn.

## 5. Use the Workroom board

One Workroom binds one complete collaboration space: a group, channel, or GitHub repository. One Bot Endpoint may serve multiple Workrooms.

**Workroom Configuration** writes the persistent Runtime Catalog and takes effect immediately. It does not write `ai.workrooms` or require a Host restart. Member Agents must reference current `ai.agents` bindings.

Runs, Tasks, Assignments, Reviewer state, and Sponsor Gates are read-only projections of the Workroom Journal. Console cannot fabricate Task state; writes use authenticated typed control ports.

## 6. Keep full and demo authority separate

- Full token: Host policy may allow configuration, environment, file, database, and control operations.
- Demo token: read-only catalogs and projections; no raw YAML, sending, rendering, or mutation.
- A token is a credential. Keep it out of URLs, screenshots, and public frontend configuration.

For remote deployment, configure `http.corsOrigins` and proxy API, SSE, WebSocket, and page entries. Proxying ordinary HTTP alone is incomplete.

## 7. Use one diagnostic sequence

1. Check connection and health on the Dashboard.
2. Confirm inbound delivery in Conversations & Channels.
3. Confirm the command, Tool, or Prompt Section in Runtime Capabilities.
4. Inspect execution steps and terminal state in Agent Overview.
5. Narrow Logs to the same time window and source.

## Next

- Console and Host boundaries: [Console architecture](../console/)
- Workroom facts and authority: [Workroom Kernel](../ai/agent.md#workroom-kernel)
- Multi-platform production example: [Community Bot](../showcase/community-bot.md)
