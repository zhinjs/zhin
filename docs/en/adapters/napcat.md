---
title: "@zhin.js/adapter-napcat"
package: "@zhin.js/adapter-napcat"
tier: Experimental
---

::: info Documentation Sync
This page is auto-generated from [`plugins/adapters/napcat/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/napcat/README.md). Please edit the in-package README and then run `pnpm sync:adapter-docs`.
:::

<!-- sync-adapter-docs:sha256=792c33d08b598cae -->

# @zhin.js/adapter-napcat

Zhin.js [NapCatQQ](https://github.com/NapNeko/NapCatQQ) adapter (Plugin Runtime, OneBot 11 + NapCat extensions). Default is **forward WebSocket client** (`connection: ws`); also supports **reverse WS** and **HTTP POST reporting** (via `httpHostToken`).

## Features

- OneBot 11 + go-cqhttp extensions + NapCat-specific API
- Convention-based `defineAdapter` / `definePlugin` (no `usePlugin` needed)
- **Forward WebSocket** (`connection: ws`): the application connects to NapCat WS
- `access_token` authentication (Bearer + query)
- Inbound via `Endpoint.emit(...)` (deduplication + self-message filtering); outbound `send({ conversation, payload })`
- 41 AI tools (`agent/tools/`)

## Installation

```bash
pnpm add @zhin.js/adapter-napcat
```

## Plugin Runtime

- `@zhin.js/adapter` — convention-based `adapters/napcat.ts` (`defineAdapter`)
- `@zhin.js/core` — `Endpoint.emit(...)` inbound, `outboundMessageToken` outbound
- `zhin.js` — `plugin.ts` (`definePlugin`)
- Configuration goes to `plugins.<instanceKey>` via the plugin's `schema.json`

Inbound: `gateway.receive({ conversation, message, content, sender, metadata })` (`kind: 'private'|'group'`; group temp sessions carry the group in `parent`)
Outbound: `send({ conversation, payload })` -> WS `send_private_msg` / `send_group_msg`

## Prerequisites

1. Install and log into NapCatQQ, then enable one matching OneBot 11 connection.
2. Zhin must reach NapCat for forward WS; NapCat must reach the Zhin HTTP Host for reverse WS or HTTP reports.
3. Configure the same `access_token` on both sides and never expose an unauthenticated port.

## Minimal Configuration

```yaml
# zhin.config.yml (Plugin Runtime)
plugins:
  napcat:
    connection: ws
    reconnect_interval: 5000
    heartbeat_interval: 30000
    endpoints:
      - name: my-bot
        url: "ws://127.0.0.1:3001"
        access_token: "${NAPCAT_TOKEN}"
```

The root plugin `zhin.plugins` (or project graph) must reference `@zhin.js/adapter-napcat` (`instanceKey: napcat`).

## Connection Modes

| connection | Status |
|------------|--------|
| `ws` | Implemented (recommended) |
| `wss` | Implemented: reverse WS (httpHostToken) |
| `http` | Implemented: POST inbound + `http_url/{action}` outbound |

## Authentication

- **Bearer**: `Authorization: Bearer <access_token>`
- Forward WS attaches request headers during Upgrade and includes `access_token` in the URL query

## AI Tools

| Category | Path |
|----------|------|
| Permit vocabulary | `agent/PERMITS.md` |
| Platform tools | `agent/tools/*.ts` |
| Skill documentation | `agent/skills/napcat.md` |

## Migration Notes (Plugin Runtime)

- **Notice / request / meta side events** enter the unified `Endpoint.emit(...)` ingress and dispatch to handlers. Requests expose `$approve` / `$reject`; messages continue through `outboundMessageToken`.
- **Group management tools have not been migrated yet**: the old Adapter registered a full set of agent tools (kick/mute/group card, etc.) via `createSceneManagementTools`; after migration, `agent/tools/` only covers NapCat extension APIs. Other group management capabilities can be invoked via `callApi` (e.g., `set_group_kick`, `set_group_ban`) as an escape hatch.
- **Platform permission access control**: `plugin.ts` setup has registered `registerDefaultScenePlatformPermitChecker('napcat')`. `scene_admin` / `scene_owner` are determined based on the sender's `role` (owner / admin) in the inbound metadata.

## Documentation Links

- [NapCatQQ](https://github.com/NapNeko/NapCatQQ)
- [Adapters overview](https://zhin.js.org/essentials/adapters)

## Troubleshooting

| Symptom | Check |
| --- | --- |
| WS connection is refused | NapCat URL, port, and connection direction |
| 401 or handshake failure | Matching tokens and proxy preservation of Authorization |
| Duplicate/self messages | Ensure only one report connection is enabled |
| Requests/notices are missing | NapCat notice/request/meta reports and Endpoint categories |

## License

MIT License
