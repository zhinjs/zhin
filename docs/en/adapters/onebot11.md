---
title: "@zhin.js/adapter-onebot11"
package: "@zhin.js/adapter-onebot11"
tier: Advanced
---

::: info Documentation Sync
This page translates [`plugins/adapters/onebot11/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/onebot11/README.md). Keep this English page aligned with the README; `pnpm sync:adapter-docs` updates the Chinese pages.
:::

<!-- sync-adapter-docs:sha256=e78465fa47745ef0 -->

# @zhin.js/adapter-onebot11

Zhin.js [OneBot 11](https://github.com/botuniverse/onebot-11) adapter (Plugin Runtime). The production path is a forward WebSocket client (`connection: ws`); reverse WS is also supported (`connection: wss`, via `httpHostToken`).

## Features

- [OneBot 11 Standard](https://github.com/botuniverse/onebot-11) compatible (events + actions)
- Convention-based `defineAdapter` / `definePlugin` (no `usePlugin` needed)
- **Forward WebSocket** (`connection: ws`): the application connects to the OneBot implementation's WS server
- `access_token` authentication (Bearer + query)
- Inbound via `endpoint[endpointSpec].events.emit(...)`; outbound through the registered send hook

## Installation

```bash
pnpm add @zhin.js/adapter-onebot11
```

## Plugin Runtime

The owning `Adapter` manages desired accounts and running incarnations. The actual SDK or protocol Client implements structural `Endpoint`; framework hooks use `endpointSpec` without replacing native SDK APIs. Complete accepted callbacks enter through `events.run(...)` before deduplication and asynchronous normalization; see [Adapter authoring](/en/authoring/adapters).

- `@zhin.js/adapter` — convention-based `adapters/onebot11/index.ts` (`defineAdapter`)
- `@zhin.js/core` — `endpoint[endpointSpec].events.emit(...)` inbound, `outboundMessageToken` outbound
- `zhin.js` — `plugin.ts` (`definePlugin`)
- Configuration goes to the top-level `<instanceKey>` block via the plugin's `schema.json`

`AdapterIndex` merges instance defaults with each `endpoints[]` override. The protocol receives one expanded endpoint configuration and no longer reads nested endpoint rows, the old `type: ws_reverse` alias, or process environment variables.

Inbound: `endpoint[endpointSpec].events.emit('message.receive', { conversation, message, content, sender, metadata })` (`kind: 'private'|'group'`)
Outbound: `send({ conversation, payload })` -> WS `send_private_msg` / `send_group_msg` (payload is rendered by gateway/core; no segment-mapper)

## Prerequisites

1. Start a compatible OneBot 11 implementation and choose forward or reverse WebSocket.
2. Zhin must reach the implementation for forward WS; the implementation must reach Zhin for reverse WS.
3. Configure the same `access_token` on both sides and require authentication in production.

## Minimal Configuration

```yaml
configVersion: 2
# zhin.config.yml (Plugin Runtime)
plugins:
  onebot11: "@zhin.js/adapter-onebot11"
onebot11:
  connection: ws
  reconnect_interval: 5000
  heartbeat_interval: 30000
  endpoints:
    - id: ob11-bot
      url: "ws://127.0.0.1:6700"
      access_token: "${ONEBOT11_ACCESS_TOKEN}"
```

The root plugin the main configuration `plugins` map (or project graph) must reference `@zhin.js/adapter-onebot11` (`instanceKey: onebot11`).

## Connection Modes

| connection | Status |
|------------|--------|
| `ws` | Implemented (recommended) |
| `wss` | Implemented: reverse WS (`httpHostToken`) |

## Authentication

- **Bearer**: `Authorization: Bearer <access_token>`
- Forward WS attaches request headers during Upgrade and includes `access_token` in the URL query

## Actions and Events

- Events: `post_type` (message/notice/request/meta_event), `message_type`, `message`, etc.
- Actions: `send_private_msg`, `send_group_msg`, `delete_msg`, `set_group_special_title`, etc.

## AI Tools

| Category | Path |
|----------|------|
| Permit vocabulary | `PERMITS.md` |
| Platform tools | `tools/set_title/index.ts` -> `onebot11_set_title` |
| Skill documentation | `agents/onebot11/skills/onebot11/SKILL.md` |

## Migration Notes (Plugin Runtime)

- **Notice / request / meta side events** enter the unified `endpoint[endpointSpec].events.emit(...)` ingress and dispatch to handlers. Messages continue through `outboundMessageToken`.
- **Group management tools have not been migrated yet**: the old Adapter registered a full set of agent tools (kick/mute/group card, etc.) via `createSceneManagementTools`; after migration, only `onebot11_set_title` is retained. Other group management capabilities can be invoked via `$client.call()` (e.g., `set_group_kick`, `set_group_ban`) as an escape hatch.
- **Platform permission access control**: `plugin.ts` setup registers `createSceneRolePlatformChecker()` through the generation-owned `permissionHostToken`. `scene_admin` / `scene_owner` are determined based on the sender's `role` (owner / admin) in the inbound metadata.

## Documentation Links

- [OneBot 11 Standard](https://github.com/botuniverse/onebot-11)
- [Adapter Overview](https://zhin.js.org/essentials/adapters)

## Console page

Open the Console **OneBot 11** page (route `/onebot11`) to:

- view running connections and test connectivity;
- add, edit, start, stop, replace, or remove accounts through Host runtime storage; startup configuration and `.env` remain unchanged;
- complete LoginAssist tasks (QR code, slider or device confirmation) when the adapter asks for a login;

An administrator must review and confirm the existing account list before its first migration; identity and history are retained. New or replaced accounts are saved disabled and must be started explicitly. A connection update reconnects only that account; replacement uses a new internal identity and does not inherit Sessions or settings. If a commit outcome is unknown, refresh to verify it before taking another action.

Reading requires `onebot11:read`; writes require `onebot11:write`. A full admin token is unrestricted. "Add endpoint" is equivalent to the old `onebot11 endpoint add` command.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| WS cannot connect | Direction, URL, port, and implementation WS service |
| 401 or closed handshake | Matching Header/query token |
| Receives but cannot send | Send-action support and account risk controls |
| notice/request missing | Implementation post types and Endpoint request/notice views |

## License

MIT License
