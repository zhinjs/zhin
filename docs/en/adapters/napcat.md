---
title: "@zhin.js/adapter-napcat"
package: "@zhin.js/adapter-napcat"
tier: Experimental
---

::: info Documentation Sync
This page translates [`plugins/adapters/napcat/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/napcat/README.md). Keep this English page aligned with the README; `pnpm sync:adapter-docs` updates the Chinese pages.
:::

<!-- sync-adapter-docs:sha256=792c33d08b598cae -->

# @zhin.js/adapter-napcat

Zhin.js [NapCatQQ](https://github.com/NapNeko/NapCatQQ) adapter (Plugin Runtime, OneBot 11 + NapCat extensions). Default is **forward WebSocket client** (`connection: ws`); also supports **reverse WS** and **HTTP POST reporting** (via `httpHostToken`).

## Features

- OneBot 11 + go-cqhttp extensions + NapCat-specific API
- Convention-based `defineAdapter` / `definePlugin` (no `usePlugin` needed)
- **Forward WebSocket** (`connection: ws`): the application connects to NapCat WS
- `access_token` authentication (Bearer + query)
- Inbound via `endpoint[endpointSpec].events.emit(...)` (deduplication + self-message filtering); outbound through the registered send hook
- 41 AI tools (`tools/`)

## Installation

```bash
pnpm add @zhin.js/adapter-napcat
```

## Plugin Runtime

The owning `Adapter` manages desired accounts and running incarnations. The actual SDK or protocol Client implements structural `Endpoint`; framework hooks use `endpointSpec` without replacing native SDK APIs. Complete accepted callbacks enter through `events.run(...)` before deduplication and asynchronous normalization; see [Adapter authoring](/en/authoring/adapters).

- `@zhin.js/adapter` — convention-based `adapters/napcat/index.ts` (`defineAdapter`)
- `@zhin.js/core` — `endpoint[endpointSpec].events.emit(...)` inbound, `outboundMessageToken` outbound
- `zhin.js` — `plugin.ts` (`definePlugin`)
- Configuration goes to the top-level `<instanceKey>` block via the plugin's `schema.json`

Inbound: `endpoint[endpointSpec].events.emit('message.receive', { conversation, message, content, sender, metadata })` (`kind: 'private'|'group'`; group temp sessions carry the group in `parent`)
Outbound: `send({ conversation, payload })` -> WS `send_private_msg` / `send_group_msg`

## Prerequisites

1. Install and log into NapCatQQ, then enable one matching OneBot 11 connection.
2. Zhin must reach NapCat for forward WS; NapCat must reach the Zhin HTTP Host for reverse WS or HTTP reports.
3. Configure the same `access_token` on both sides and never expose an unauthenticated port.

## Minimal Configuration

```yaml
configVersion: 2
# zhin.config.yml (Plugin Runtime)
plugins:
  napcat: "@zhin.js/adapter-napcat"
napcat:
  connection: ws
  reconnect_interval: 5000
  heartbeat_interval: 30000
  endpoints:
    - id: my-bot
      url: "ws://127.0.0.1:3001"
      access_token: "${NAPCAT_TOKEN}"
```

AdapterIndex merges instance connection defaults into every endpoint. The protocol receives only
one expanded endpoint config and does not infer endpoint ids from environment variables.

The root plugin the main configuration `plugins` map (or project graph) must reference `@zhin.js/adapter-napcat` (`instanceKey: napcat`).

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
| Permit vocabulary | `PERMITS.md` |
| Platform tools | `tools/<name>/index.ts` |
| Skill documentation | `agents/napcat/skills/napcat-*/SKILL.md` split by messaging, group content, settings, files/history, media, and account |

## Migration Notes (Plugin Runtime)

- **Notice / request / meta side events** enter the unified `endpoint[endpointSpec].events.emit(...)` ingress and dispatch to handlers. Requests expose `$approve` / `$reject`; messages continue through `outboundMessageToken`.
- **Group management tools have not been migrated yet**: the old Adapter registered a full set of agent tools (kick/mute/group card, etc.) via `createSceneManagementTools`; after migration, `tools/` only covers NapCat extension APIs. Other group management capabilities can be invoked via `callApi` (e.g., `set_group_kick`, `set_group_ban`) as an escape hatch.
- **Platform permission access control**: `plugin.ts` setup registers `createSceneRolePlatformChecker()` through the generation-owned `permissionHostToken`. `scene_admin` / `scene_owner` are determined based on the sender's `role` (owner / admin) in the inbound metadata.

## Documentation Links

- [NapCatQQ](https://github.com/NapNeko/NapCatQQ)
- [Adapters overview](https://zhin.js.org/essentials/adapters)

## Console page

Open the Console **NapCat** page (route `/napcat`) to:

- view running connections and test connectivity;
- add, edit, start, stop, replace, or remove accounts through Host runtime storage; startup configuration and `.env` remain unchanged;
- complete LoginAssist tasks (QR code, slider or device confirmation) when the adapter asks for a login;

An administrator must review and confirm the existing account list before its first migration; identity and history are retained. New or replaced accounts are saved disabled and must be started explicitly. A connection update reconnects only that account; replacement uses a new internal identity and does not inherit Sessions or settings. If a commit outcome is unknown, refresh to verify it before taking another action.

Reading requires `napcat:read`; writes require `napcat:write`. A full admin token is unrestricted. "Add endpoint" is equivalent to the old `napcat endpoint add` command.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| WS connection is refused | NapCat URL, port, and connection direction |
| 401 or handshake failure | Matching tokens and proxy preservation of Authorization |
| Duplicate/self messages | Ensure only one report connection is enabled |
| Requests/notices are missing | NapCat notice/request/meta reports and Endpoint categories |

## License

MIT License
