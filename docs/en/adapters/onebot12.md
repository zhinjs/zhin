---
title: "@zhin.js/adapter-onebot12"
package: "@zhin.js/adapter-onebot12"
tier: Experimental
---

::: info Documentation Sync
This page is auto-generated from [`plugins/adapters/onebot12/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/onebot12/README.md). Please edit the in-package README and then run `pnpm sync:adapter-docs`.
:::

<!-- sync-adapter-docs:sha256=a0508889b09dd967 -->

# @zhin.js/adapter-onebot12

Zhin.js [OneBot 12](https://12.onebot.dev/) adapter (Plugin Runtime). Default is **forward WebSocket client** (`connection: ws`); also supports **HTTP Webhook** and **reverse WS** (routes registered via `httpHostToken`).

## Features

- [OneBot 12 Standard](https://12.onebot.dev/) compatible (events + actions)
- Convention-based `defineAdapter` / `definePlugin` (no `usePlugin` needed)
- **Forward WebSocket** (`connection: ws`): the application connects to the OneBot implementation's WS server
- `access_token` authentication (Bearer + query)
- Inbound via `messageGatewayToken`; outbound `send({ target, payload })`

## Installation

```bash
pnpm add @zhin.js/adapter-onebot12
```

## Plugin Runtime

- `@zhin.js/adapter` — convention-based `adapters/onebot12.ts` (`defineAdapter`)
- `@zhin.js/core` — `messageGatewayToken` inbound/outbound
- `@zhin.js/plugin-runtime` — `plugin.ts` (`definePlugin`)
- Configuration goes to `plugins.<instanceKey>` via the plugin's `schema.json`

Inbound: `gateway.receive({ adapter, target: "private:uid"| "group:gid"|..., content, sender, metadata })`
Outbound: `send({ target, payload })` -> WS `send_message` (payload is rendered by gateway/core; no segment-mapper)

## Minimal Configuration

```yaml
# zhin.config.yml (Plugin Runtime)
plugins:
  onebot12:
    connection: ws
    reconnect_interval: 5000
    heartbeat_interval: 30000
    endpoints:
      - name: ob12-bot
        url: "ws://127.0.0.1:6700"
        access_token: "${ONEBOT12_ACCESS_TOKEN}"
```

The root plugin `zhin.plugins` (or project graph) must reference `@zhin.js/adapter-onebot12` (`instanceKey: onebot12`).

## Connection Modes

| connection | Status |
|------------|--------|
| `ws` | Implemented (recommended) |
| `webhook` | Implemented: POST inbound + `api_url` HTTP outbound |
| `wss` | Implemented: reverse WS (httpHostToken) |

## Authentication

- **Bearer**: `Authorization: Bearer <access_token>`
- Forward WS attaches request headers during Upgrade and includes `access_token` in the URL query

## Actions and Events

- Events: `type` (meta/message/notice/request), `detail_type`, `message`, etc. See [Events](https://12.onebot.dev/connect/data-protocol/event/).
- Actions: `send_message`, `delete_message`, `get_status`, etc. See [Action Requests](https://12.onebot.dev/connect/data-protocol/action-request/).

## AI Tools

See `agent/skills/onebot12.md` for skill documentation.

## Documentation Links

- [OneBot 12 Standard](https://12.onebot.dev/)
- [OneBot Connect WebSocket](https://12.onebot.dev/connect/communication/websocket/)
- [Adapters overview](https://zhin.js.org/essentials/adapters)

## License

MIT License
