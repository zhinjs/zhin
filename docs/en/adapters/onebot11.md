---
title: "@zhin.js/adapter-onebot11"
package: "@zhin.js/adapter-onebot11"
tier: Advanced
---

::: info Documentation Sync
This page is auto-generated from [`plugins/adapters/onebot11/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/onebot11/README.md). Please edit the in-package README and then run `pnpm sync:adapter-docs`.
:::

<!-- sync-adapter-docs:sha256=e78465fa47745ef0 -->

# @zhin.js/adapter-onebot11

Zhin.js [OneBot 11](https://github.com/botuniverse/onebot-11) adapter (Plugin Runtime). The production path is a forward WebSocket client (`connection: ws`); reverse WS is also supported (`connection: wss`, via `httpHostToken`).

## Features

- [OneBot 11 Standard](https://github.com/botuniverse/onebot-11) compatible (events + actions)
- Convention-based `defineAdapter` / `definePlugin` (no `usePlugin` needed)
- **Forward WebSocket** (`connection: ws`): the application connects to the OneBot implementation's WS server
- `access_token` authentication (Bearer + query)
- Inbound via `messageGatewayToken`; outbound `send({ conversation, payload })`

## Installation

```bash
pnpm add @zhin.js/adapter-onebot11
```

## Plugin Runtime

- `@zhin.js/adapter` — convention-based `adapters/onebot11.ts` (`defineAdapter`)
- `@zhin.js/core` — `messageGatewayToken` inbound/outbound
- `zhin.js` — `plugin.ts` (`definePlugin`)
- Configuration goes to `plugins.<instanceKey>` via the plugin's `schema.json`

Inbound: `gateway.receive({ conversation, message, content, sender, metadata })` (`kind: 'private'|'group'`)
Outbound: `send({ conversation, payload })` -> WS `send_private_msg` / `send_group_msg` (payload is rendered by gateway/core; no segment-mapper)

## Prerequisites

1. Start a compatible OneBot 11 implementation and choose forward or reverse WebSocket.
2. Zhin must reach the implementation for forward WS; the implementation must reach Zhin for reverse WS.
3. Configure the same `access_token` on both sides and require authentication in production.

## Minimal Configuration

```yaml
# zhin.config.yml (Plugin Runtime)
plugins:
  onebot11:
    connection: ws
    reconnect_interval: 5000
    heartbeat_interval: 30000
    endpoints:
      - name: ob11-bot
        url: "ws://127.0.0.1:6700"
        access_token: "${ONEBOT11_ACCESS_TOKEN}"
```

The root plugin `zhin.plugins` (or project graph) must reference `@zhin.js/adapter-onebot11` (`instanceKey: onebot11`).

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
| Permit vocabulary | `agent/PERMITS.md` |
| Platform tools | `agent/tools/set_title.ts` -> `onebot11_set_title` |
| Skill documentation | `agent/skills/onebot11.md` |

## Migration Notes (Plugin Runtime)

- **Notice / request / meta side events** enter `sideEventGatewayToken` and dispatch to handlers. Messages continue through `messageGatewayToken`.
- **Group management tools have not been migrated yet**: the old Adapter registered a full set of agent tools (kick/mute/group card, etc.) via `createSceneManagementTools`; after migration, only `onebot11_set_title` is retained. Other group management capabilities can be invoked via `callApi` (e.g., `set_group_kick`, `set_group_ban`) as an escape hatch.
- **Platform permission access control**: `plugin.ts` setup has registered `registerDefaultScenePlatformPermitChecker('onebot11')`. `scene_admin` / `scene_owner` are determined based on the sender's `role` (owner / admin) in the inbound metadata.

## Documentation Links

- [OneBot 11 Standard](https://github.com/botuniverse/onebot-11)
- [Adapter Overview](https://zhin.js.org/essentials/adapters)

## Troubleshooting

| Symptom | Check |
| --- | --- |
| WS cannot connect | Direction, URL, port, and implementation WS service |
| 401 or closed handshake | Matching Header/query token |
| Receives but cannot send | Send-action support and account risk controls |
| notice/request missing | Implementation post types and Endpoint request/notice views |

## License

MIT License
