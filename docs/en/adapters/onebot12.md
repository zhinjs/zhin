---
title: "@zhin.js/adapter-onebot12"
package: "@zhin.js/adapter-onebot12"
tier: Experimental
---

::: info Documentation Sync
This page translates [`plugins/adapters/onebot12/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/onebot12/README.md). Keep this English page aligned with the README; `pnpm sync:adapter-docs` updates the Chinese pages.
:::

<!-- sync-adapter-docs:sha256=a0508889b09dd967 -->

# @zhin.js/adapter-onebot12

Zhin.js [OneBot 12](https://12.onebot.dev/) adapter (Plugin Runtime). Default is **forward WebSocket client** (`connection: ws`); also supports **HTTP Webhook** and **reverse WS** (routes registered via `httpHostToken`).

## Features

- [OneBot 12 Standard](https://12.onebot.dev/) compatible (events + actions)
- Convention-based `defineAdapter` / `definePlugin` (no `usePlugin` needed)
- **Forward WebSocket** (`connection: ws`): the application connects to the OneBot implementation's WS server
- `access_token` authentication (Bearer + query)
- Inbound via `endpoint[endpointSpec].events.emit(...)`; outbound through the registered send hook

## Installation

```bash
pnpm add @zhin.js/adapter-onebot12
```

## Plugin Runtime

The owning `Adapter` manages desired accounts and running incarnations. The actual SDK or protocol Client implements structural `Endpoint`; framework hooks use `endpointSpec` without replacing native SDK APIs. Complete accepted callbacks enter through `events.run(...)` before deduplication and asynchronous normalization; see [Adapter authoring](/en/authoring/adapters).

- `@zhin.js/adapter` — convention-based `adapters/onebot12/index.ts` (`defineAdapter`)
- `@zhin.js/core` — `endpoint[endpointSpec].events.emit(...)` inbound, `outboundMessageToken` outbound
- `zhin.js` — `plugin.ts` (`definePlugin`)
- Configuration goes to the top-level `<instanceKey>` block via the plugin's `schema.json`

`AdapterIndex` merges instance defaults with each `endpoints[]` override. The protocol receives one expanded endpoint configuration and does not inspect nested endpoint rows or infer identity from process environment variables. Webhook endpoints require both `path` and `api_url`, so their bidirectional capability is complete before startup.

Inbound: `endpoint[endpointSpec].events.emit('message.receive', { conversation, message, content, sender, metadata })` (`kind: 'private'|'group'|'channel'`; guild containers land in `parent`)
Outbound: `send({ conversation, payload })` -> WS `send_message` (payload is rendered by gateway/core; no segment-mapper)

## Prerequisites

1. Start a compatible OneBot 12 implementation that supports the selected WS or Webhook mode.
2. Webhook outbound also requires a reachable `api_url`; reverse connections require access to the Zhin HTTP Host.
3. Configure the same `access_token` on both sides and require authentication in production.

## Minimal Configuration

```yaml
configVersion: 2
# zhin.config.yml (Plugin Runtime)
plugins:
  onebot12: "@zhin.js/adapter-onebot12"
onebot12:
  connection: ws
  reconnect_interval: 5000
  heartbeat_interval: 30000
  endpoints:
    - id: ob12-bot
      platform: qq
      userId: "123456789"
      url: "ws://127.0.0.1:6700"
      access_token: "${ONEBOT12_ACCESS_TOKEN}"
```

The root plugin the main configuration `plugins` map (or project graph) must reference `@zhin.js/adapter-onebot12` (`instanceKey: onebot12`).

## Connection Modes

| connection | Status |
|------------|--------|
| `ws` | Implemented (recommended) |
| `webhook` | Implemented: POST inbound + `api_url` HTTP outbound |
| `wss` | Implemented: reverse WS (httpHostToken) |

## Account Selection

Each Endpoint requires `platform` and `userId`, matching OneBot12 `self.platform` and `self.user_id`. `id` is only the local account name; neither it nor the first server event selects a bot. WS, reverse WS, and Webhook filter events before native SDK admission. Actions, including `$client.call()` and SDK helpers, carry the fixed top-level `self: { platform, user_id }`; `params.self` cannot redirect them. Changing this selector requires explicit account replacement, initially disabled; old history is retained.

## Authentication

- **Bearer**: `Authorization: Bearer <access_token>`
- Forward WS attaches request headers during Upgrade and includes `access_token` in the URL query

## Actions and Events

- Events: `type` (meta/message/notice/request), `detail_type`, `message`, etc. See [Events](https://12.onebot.dev/connect/data-protocol/event/).
- Actions: `send_message`, `delete_message`, `get_status`, etc. See [Action Requests](https://12.onebot.dev/connect/data-protocol/action-request/).

## AI Tools

See `skills/onebot12/SKILL.md` for skill documentation.

## Documentation Links

- [OneBot 12 Standard](https://12.onebot.dev/)
- [OneBot Connect WebSocket](https://12.onebot.dev/connect/communication/websocket/)
- [Adapters overview](https://zhin.js.org/essentials/adapters)

## Console page

Open the Console **OneBot 12** page (route `/onebot12`) to:

- view running connections and test connectivity;
- add, edit, start, stop, replace, or remove accounts through Host runtime storage; startup configuration and `.env` remain unchanged;
- complete LoginAssist tasks (QR code, slider or device confirmation) when the adapter asks for a login;

An administrator must review and confirm the existing account list before its first migration; identity and history are retained. New or replaced accounts are saved disabled and must be started explicitly. A connection update reconnects only that account; replacement uses a new internal identity and does not inherit Sessions or settings. If a commit outcome is unknown, refresh to verify it before taking another action.

Reading requires `onebot12:read`; writes require `onebot12:write`. A full admin token is unrestricted. "Add endpoint" is equivalent to the old `onebot12 endpoint add` command.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| WS connection fails | OneBot version, direction, URL, and port |
| Webhook receives but cannot send | Reachable `api_url` and `send_message` support |
| 401 or handshake failure | Matching Header/query token |
| Event fields are rejected | The implementation must emit OneBot 12, not v11 structures |

## License

MIT License
