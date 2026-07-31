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
- Inbound via `messageGatewayToken` (deduplication + self-message filtering); outbound `send({ target, payload })`
- 41 AI tools (`agent/tools/`)

## Installation

```bash
pnpm add @zhin.js/adapter-napcat
```

## Plugin Runtime

- `@zhin.js/adapter` — convention-based `adapters/napcat.ts` (`defineAdapter`)
- `@zhin.js/core` — `messageGatewayToken` inbound/outbound
- `@zhin.js/plugin-runtime` — `plugin.ts` (`definePlugin`)
- Configuration goes to `plugins.<instanceKey>` via the plugin's `schema.json`

Inbound: `gateway.receive({ adapter, target: "private:uid"|"group:gid", content, sender, metadata })`
Outbound: `send({ target, payload })` -> WS `send_private_msg` / `send_group_msg`

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

- **Notice / request side events have been removed**: the old Adapter built `notice.receive` / `request.receive` events (including `$approve` / `$reject`) for `post_type: notice|request`; the new Plugin Runtime (`messageGatewayToken`) has no side-event bus yet — inbound only processes `post_type: message`, and notice / request events are silently discarded. Friend/group join request approval can be done via `callApi('set_friend_add_request' | 'set_group_add_request')`.
- **Group management tools have not been migrated yet**: the old Adapter registered a full set of agent tools (kick/mute/group card, etc.) via `createSceneManagementTools`; after migration, `agent/tools/` only covers NapCat extension APIs. Other group management capabilities can be invoked via `callApi` (e.g., `set_group_kick`, `set_group_ban`) as an escape hatch.
- **Platform permission access control**: `plugin.ts` setup has registered `registerDefaultScenePlatformPermitChecker('napcat')`. `scene_admin` / `scene_owner` are determined based on the sender's `role` (owner / admin) in the inbound metadata.

## Documentation Links

- [NapCatQQ](https://github.com/NapNeko/NapCatQQ)
- [Adapters overview](https://zhin.js.org/essentials/adapters)

## License

MIT License
