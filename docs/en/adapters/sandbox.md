---
title: "@zhin.js/adapter-sandbox"
package: "@zhin.js/adapter-sandbox"
tier: Stable
---

::: info Documentation Sync
This page is auto-generated from [`plugins/adapters/sandbox/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/sandbox/README.md). Please edit the in-package README and then run `pnpm sync:adapter-docs`.
:::

<!-- sync-adapter-docs:sha256=a6fa99a21ab163aa -->

# @zhin.js/adapter-sandbox

Zhin.js Sandbox adapter — a WebSocket-based local testing adapter. The browser-side chat UI opens a Sandbox window for debugging in the **[Remote Console](https://console.zhin.dev)** (Host exposes only the Console API).

## Features

- **Node Host**: WebSocket `/sandbox`
- Browser-side React chat UI
- Supports multiple simultaneous client connections
- No third-party platform account required — works out of the box
- Ideal for local development and plugin debugging

## Installation

```bash
pnpm add @zhin.js/adapter-sandbox
```

## Prerequisites

Sandbox needs no external account. Let `zhin runtime start` assemble the HTTP Host and ensure the browser can reach the Host address printed at startup.

## Dependencies

### Plugin Runtime (new, `zhin runtime start`)

- `@zhin.js/adapter` — convention-based `adapters/sandbox.ts`
- `@zhin.js/host-http` — `httpHostToken` provided by Root (WebSocket `/sandbox` + Console HTTP)
- `@zhin.js/core` — `Endpoint.emit(...)` inbound, `outboundMessageToken` outbound
- `@zhin.js/page` + `pages/index.tsx` — ADR 0046 convention page (`definePage`; route `/sandbox`)

Root loads `@zhin.js/host-http`, `ConsoleRuntime`, and `ClientBuildModuleRuntime` at `zhin runtime start`. Open `http://<host>:<port>/console` to browse pages. The Sandbox page (route `/sandbox`, sharing the same path as WebSocket `/sandbox`: GET opens the page, Upgrade goes to WS) has a built-in chat shell.

The old `client/` (`register(api)` / `pageManager.addEntry`) is kept only as a reference for the legacy Host stack and is **not** the Plugin Runtime production entry point.

### Legacy Host Stack (removed)

The original legacy plugin packages `@zhin.js/host-router` (HTTP service) and `@zhin.js/host-api` (Host-side Console API, `addEntry` to register Sandbox extensions) have been removed. `zhin dev` now auto-assembles the Console/HTTP Host via `@zhin.js/cli` (`@zhin.js/host-http` + `@zhin.js/pagemanager`), so no Host plugins need to be installed.

- `@zhin.js/client` — Remote Console client SDK (UI lives in the zhin-console repo)

The outbound wire only does JSON wrapping; the old `segment-mapper` (canonical segments) normalization has been lifted to the gateway/core render chain.

## Configuration

**Recommended (consistent with [minimal-bot](/getting-started/))**: `plugins.sandbox.endpoints: []` — when the "Sandbox" page is opened in the Remote Console, a bot (e.g., `sandbox-xxxx`) is **auto-created** via the `/sandbox` WebSocket. No need to write `context: sandbox` in the YAML.

```yaml
# zhin.config.yml (Plugin Runtime)
plugins:
  sandbox:
    endpoints: []
```

Optional: if you want a **fixed-name** offline placeholder bot to appear in the bot list on startup, configure it explicitly:

```yaml
plugins:
  sandbox:
    endpoints:
      - name: sandbox-bot
        context: sandbox
        owner: sandbox-user
```

## Usage

1. Start the Zhin instance: `pnpm dev` (the terminal will print the Host address, typically `http://127.0.0.1:8086`)
2. Open the **[Remote Console](https://console.zhin.dev)**, set the API Base to match the Host address, and set the Token to match `http.token` / `HTTP_TOKEN`
3. Send messages for testing on the Console **Sandbox** page after connecting

Each browser client creates a Sandbox Bot upon connection (named `sandbox-xxxx` when no fixed name is configured in YAML).

The connection is established via `Router.ws("/sandbox")` (auto-mounted by the plugin's `useContext("router")`).

## Message Format

Sandbox uses a JSON message format:

```json
{
  "type": "message",
  "id": "msg-001",
  "content": "Hello",
  "timestamp": 1700000000000
}
```

## Use Cases

- Local development and debugging of plugin logic
- Testing commands and AI tool invocations
- Feature verification without depending on external platforms

## AI Tools

See `agent/skills/sandbox.md` for skill documentation (local sandbox debugging constraints).


## Troubleshooting

| Symptom | Check |
| --- | --- |
| Console cannot connect | Host, port, and token printed at startup |
| Sandbox is blank | HTTP Host port degradation and browser authentication/CORS errors |
| History is missing after refresh | Current Endpoint/channel, history RPC, and recovery-gap logs |
| Command or Tool is absent | Publication in the current generation under Runtime Capabilities |

## License

MIT License
