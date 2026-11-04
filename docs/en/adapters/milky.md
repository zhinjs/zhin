---
title: "@zhin.js/adapter-milky"
package: "@zhin.js/adapter-milky"
tier: Experimental
---

::: info Documentation Sync
This page translates [`plugins/adapters/milky/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/milky/README.md). Keep this English page aligned with the README; `pnpm sync:adapter-docs` updates the Chinese pages.
:::

<!-- sync-adapter-docs:sha256=28156c308b7af5ab -->

# @zhin.js/adapter-milky

Zhin.js [Milky](https://milky.ntqqrev.org/) protocol adapter (Plugin Runtime). Default is **forward WebSocket client** (`connection: ws`); also supports **Webhook**, **reverse WS** (via `httpHostToken`), and **SSE** (HTTP GET `/event`, parsing `text/event-stream` via fetch).

## Features

- [Milky protocol](https://milky.ntqqrev.org/guide/communication) compatible (events + HTTP API)
- Convention-based `defineAdapter` / `definePlugin` (no `usePlugin` needed)
- **Forward WebSocket** (`connection: ws`): the application connects to the protocol endpoint `ws(s)://baseUrl/event`
- `access_token` authentication (Bearer + query)
- Inbound via `endpoint[endpointSpec].events.emit(...)`; outbound through the registered send hook -> HTTP `send_*_message`

## Installation

```bash
pnpm add @zhin.js/adapter-milky
```

## Plugin Runtime

The owning `Adapter` manages desired accounts and running incarnations. The actual SDK or protocol Client implements structural `Endpoint`; framework hooks use `endpointSpec` without replacing native SDK APIs. Complete accepted callbacks enter through `events.run(...)` before deduplication and asynchronous normalization; see [Adapter authoring](/en/authoring/adapters).

- `@zhin.js/adapter` — convention-based `adapters/milky/index.ts` (`defineAdapter`)
- `@zhin.js/core` — `endpoint[endpointSpec].events.emit(...)` inbound, `outboundMessageToken` outbound
- `zhin.js` — `plugin.ts` (`definePlugin`)
- Configuration goes to the top-level `<instanceKey>` block via the plugin's `schema.json`

`AdapterIndex` merges instance defaults with each `endpoints[]` override. The protocol layer receives one expanded endpoint configuration and does not inspect nested endpoint rows or infer endpoint identity from process environment variables.

Inbound: `endpoint[endpointSpec].events.emit('message.receive', { conversation, message, content, sender, metadata })` (`kind: 'private'|'group'`; temp sessions carry the group in `parent`)
Outbound: `send({ conversation, payload })` -> HTTP `send_private_message` / `send_group_message` (payload is rendered by gateway/core; no segment-mapper)

## Prerequisites

1. Start a compatible Milky implementation and record its HTTP API and event endpoints.
2. Zhin must reach the implementation for WS/SSE; the implementation must reach Zhin for Webhook/reverse WS.
3. Configure the same `access_token` on both sides. Never expose an unauthenticated production endpoint.

## Minimal Configuration

```yaml
configVersion: 2
# zhin.config.yml (Plugin Runtime)
plugins:
  milky: "@zhin.js/adapter-milky"
milky:
  connection: ws
  reconnect_interval: 5000
  heartbeat_interval: 30000
  endpoints:
    - id: milky-bot
      baseUrl: "http://127.0.0.1:8080"
      access_token: "${MILKY_ACCESS_TOKEN}"
```

The root plugin the main configuration `plugins` map (or project graph) must reference `@zhin.js/adapter-milky` (`instanceKey: milky`).

## Connection Modes

| connection | Status |
|------------|--------|
| `ws` | Implemented (recommended) |
| `sse` | HTTP GET `/event` (`Accept: text/event-stream`) || `webhook` | Implemented: POST inbound + baseUrl HTTP API outbound |
| `wss` | Implemented: reverse WS (httpHostToken) |

## Authentication

- **Bearer**: `Authorization: Bearer <access_token>`
- Forward WS attaches request headers during Upgrade and includes `access_token` in the URL query
- HTTP API uses the same Header / query authentication

## Message ID

`{message_scene}:{peer_id}:{message_seq}` (e.g., `group:123456:10001`).

## AI Tools

| Category | Path |
|----------|------|
| Permit vocabulary | `PERMITS.md` |
| Skill documentation | `skills/milky/SKILL.md` |

## Documentation Links

- [Milky Quick Start](https://milky.ntqqrev.org/)
- [Milky Communication](https://milky.ntqqrev.org/guide/communication)
- [Adapters overview](https://zhin.js.org/essentials/adapters)

## Console page

Open the Console **Milky** page (route `/milky`) to:

- view running connections and test connectivity;
- add, edit, start, stop, replace, or remove accounts through Host runtime storage; startup configuration and `.env` remain unchanged;
- complete LoginAssist tasks (QR code, slider or device confirmation) when the adapter asks for a login;

An administrator must review and confirm the existing account list before its first migration; identity and history are retained. New or replaced accounts are saved disabled and must be started explicitly. A connection update reconnects only that account; replacement uses a new internal identity and does not inherit Sessions or settings. If a commit outcome is unknown, refresh to verify it before taking another action.

Reading requires `milky:read`; writes require `milky:write`. A full admin token is unrestricted. "Add endpoint" is equivalent to the old `milky endpoint add` command.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| WS/SSE has no events | `baseUrl`, connection mode, and implementation event service |
| 401 or handshake failure | Matching `access_token` in Bearer/query and the implementation |
| Webhook/WSS cannot connect | HTTP Host, network reachability, and callback path |
| Receives but cannot send | HTTP API and supported send actions |

## License

MIT License
