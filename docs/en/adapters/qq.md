---
title: "@zhin.js/adapter-qq"
package: "@zhin.js/adapter-qq"
tier: Advanced
---

::: info Documentation Sync
This page is auto-generated from [`plugins/adapters/qq/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/qq/README.md). Please edit the in-package README and then run `pnpm sync:adapter-docs`.
:::

<!-- sync-adapter-docs:sha256=0ef7b8aac897f9dc -->

# @zhin.js/adapter-qq

Zhin.js QQ Official Bot adapter (Plugin Runtime). By default, it sends and receives messages via the **WebSocket Gateway** (`qq-official-bot`), requiring no host-router / host-http.

## Features

- WebSocket Gateway inbound (default; no public HTTPS / host required)
- Parses private chat / group / channel messages
- Outbound `send({ conversation, payload })` -> QQ API (`conversation.kind`/`id`/`parent` structured addressing; a guild-parented private conversation is a `direct` message)
- Convention-based `defineAdapter` / `definePlugin` (no `usePlugin` needed)
- Webhook / middleware mode implemented (registers POST route via `httpHostToken`)
- AI `@` trigger annotation: group messages (GROUP_AT_MESSAGE_CREATE only delivered on @) and channel `mentions[].bot` mark `mentioned: true` in inbound metadata (in the new Plugin Runtime, plain-text content conveys @ via metadata)

## Installation

```bash
pnpm add @zhin.js/adapter-qq
```

## Plugin Runtime

- `@zhin.js/adapter` — convention-based `adapters/qq.ts` (`defineAdapter`)
- `@zhin.js/core` — `messageGatewayToken` inbound/outbound
- `zhin.js` — `plugin.ts` (`definePlugin`)
- Configuration goes to `plugins.<instanceKey>` via the plugin's `schema.json`
- **Does not require** `@zhin.js/host-http` / `@zhin.js/host-router` (WebSocket path)

Inbound: `gateway.receive({ conversation, message, content, sender, metadata })` (`kind: 'private'|'group'|'channel'`; the owning guild lands in `parent`)
Outbound: `send({ conversation, payload })` -> `sendPrivateMessage` / `sendGroupMessage` / `sendGuildMessage`

## Prerequisites

| Requirement | Description |
|-------------|-------------|
| **AppID / Secret** | Create a bot application on the [QQ Open Platform](https://q.qq.com/) and obtain them |
| **WebSocket (default)** | `qq-official-bot` forward connection; no public callback needed |
| **host-http** | **Not needed** for WebSocket; required for Webhook / middleware mode (via `httpHostToken`) |

Required fields (`endpoints[i]`): `name`, `appid`, `secret`.

## Minimal Configuration

```yaml
# zhin.config.yml (Plugin Runtime)
plugins:
  qq:
    # mode: websocket   # default
    endpoints:
      - name: my-qq-bot
        appid: ${QQ_APPID}
        secret: ${QQ_SECRET}
```

Multiple accounts: a single plugin instance can attach multiple endpoints (each item in the `endpoints` array overrides top-level fields; `name` is required):

```yaml
plugins:
  qq:
    mode: websocket
    intents: [GUILDS, GROUP_AND_C2C_EVENT]
    endpoints:
      - name: main-bot
        appid: ${QQ_APPID}
        secret: ${QQ_SECRET}
      - name: second-bot
        appid: ${QQ_APPID_2}
        secret: ${QQ_SECRET_2}
```

The root plugin `zhin.plugins` (or project graph) must reference `@zhin.js/adapter-qq` (`instanceKey: qq`).

## Endpoint Management Commands

The adapter comes with a `qq.endpoint` command group (used directly in chat, no prefix by default; affected by `commandPrefix`):

| Command | Description |
|---------|-------------|
| `qq.endpoint add [name]` | Bind via QR code on mobile QQ: sends a QR code link -> after confirmation, credentials are written to `.env` (`QQ_<NAME>_APPID/SECRET`) and appended to `plugins.qq.endpoints` (restart required to take effect) |
| `qq.endpoint cancel` | Cancel an in-progress QR code binding (only one process allowed at a time) |
| `qq.endpoint list` | List running and configured endpoints |
| `qq.endpoint remove <name>` | Remove an endpoint from configuration (`.env` keys are preserved; manual cleanup possible) |

add/cancel/remove are restricted by `master`: when the instance configuration declares a `master` (top-level or `endpoints[i]`), only the master can execute these; if unconfigured, access is open (the first person to bind via QR code becomes the owner). QR codes are currently delivered as link text (outbound rich media migration pending) — open the link on mobile QQ to scan.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `QQ_APPID` / `QQ_BOT_APPID` | Application AppID |
| `QQ_SECRET` / `QQ_BOT_SECRET` | Application Secret |
| `QQ_BOT_NAME` | Optional, default endpoint name |

## Webhook / Middleware

`mode: webhook` or `mode: middleware` registers a POST route via `httpHostToken` (default `/qq/webhook`), using the qq-official-bot Middleware receiver for signature verification and inbound processing; outbound still uses the QQ HTTP API. The Host must inject `httpHostToken`.

## AI Tools (Skill)

| Category | Path |
|----------|------|
| Permit vocabulary | `agent/PERMITS.md` |
| Platform tools | `agent/tools/` (channels, roles, etc.) |
| Skill documentation | `agent/skills/qq.md` |

## Platform Permissions (platform permit)

The platform permit checker is registered by the `plugin.ts` generation lifecycle; `@zhin.js/tool` descriptors retain `platforms` / `scopes` / `permissions`, and CapabilityIngress together with ToolSystem uniformly enforce access control via Core's `canAccessTool()`.

## Post-Migration Outbound Capability Changes

QQ Endpoints declare native Markdown and keyboard support. `UserInteraction.ask()` renders confirm/select controls as Markdown buttons. Adapters without native buttons degrade the same keyboard semantics to numbered choices.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Gateway disconnects after Identify | `botKind` and intents; public bots must not request restricted intents |
| QR binding remains offline | Console login task result, App ID, Secret, and Token |
| Webhook has no events | HTTP Host, public path, callback settings, and signature parameters |
| Markdown/button fails | Platform templates and permission; degrade by Endpoint capability |

## License

MIT License
