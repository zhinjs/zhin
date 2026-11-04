---
title: "@zhin.js/adapter-qq"
package: "@zhin.js/adapter-qq"
tier: Advanced
---

::: info Documentation Sync
This page translates [`plugins/adapters/qq/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/qq/README.md). Keep this English page aligned with the README; `pnpm sync:adapter-docs` updates the Chinese pages.
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

The owning `Adapter` manages desired accounts and running incarnations. The actual SDK or protocol Client implements structural `Endpoint`; framework hooks use `endpointSpec` without replacing native SDK APIs. Complete accepted callbacks enter through `events.run(...)` before deduplication and asynchronous normalization; see [Adapter authoring](/en/authoring/adapters).

- `@zhin.js/adapter` — convention-based `adapters/qq/index.ts` (`defineAdapter`)
- `@zhin.js/core` — `endpoint[endpointSpec].events.emit(...)` inbound, `outboundMessageToken` outbound
- `zhin.js` — `plugin.ts` (`definePlugin`)
- Configuration goes to the top-level `<instanceKey>` block via the plugin's `schema.json`
- **Does not require** `@zhin.js/host-http` / `@zhin.js/host-router` (WebSocket path)

Inbound: `endpoint[endpointSpec].events.emit('message.receive', { conversation, message, content, sender, metadata })` (`kind: 'private'|'group'|'channel'`; the owning guild lands in `parent`)
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
configVersion: 2
# zhin.config.yml (Plugin Runtime)
plugins:
  qq: "@zhin.js/adapter-qq"
qq:
  # mode: websocket   # default
  endpoints:
    - name: my-qq-bot
      appid: ${QQ_APPID}
      secret: ${QQ_SECRET}
```

Multiple accounts: a single plugin instance can attach multiple endpoints (each item in the `endpoints` array overrides top-level fields; `name` is required):

```yaml
configVersion: 2
plugins:
  qq: "@zhin.js/adapter-qq"
qq:
  mode: websocket
  intents: [ GUILDS, GROUP_AND_C2C_EVENT ]
  endpoints:
    - name: main-bot
      appid: ${QQ_APPID}
      secret: ${QQ_SECRET}
    - name: second-bot
      appid: ${QQ_APPID_2}
      secret: ${QQ_SECRET_2}
```

The root plugin the main configuration `plugins` map (or project graph) must reference `@zhin.js/adapter-qq` (`instanceKey: qq`).

## Endpoint Management Commands

The adapter comes with a `qq endpoint` command group (used directly in chat, no prefix by default; affected by `commandPrefix`):

| Command | Description |
|---------|-------------|
| `qq endpoint add [name]` | Bind via mobile QQ QR code; confirmation saves the account to Host runtime storage, disabled until explicitly started |
| `qq endpoint cancel` | Cancel an in-progress QR code binding (only one process allowed at a time) |
| `qq endpoint list` | List running and configured endpoints |
| `qq endpoint remove <name>` | Remove the runtime account and cancel its running operations; retain historical records |

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
| Permit vocabulary | `PERMITS.md` |
| Platform tools | `tools/` (channels, roles, etc.) |
| Skill documentation | `agents/qq/skills/qq/SKILL.md`、`agents/qq/skills/qq-directory/SKILL.md` |

## Platform Permissions (platform permit)

The platform permit checker is registered by the `plugin.ts` generation lifecycle; `@zhin.js/tool` descriptors retain `platforms` / `scopes` / `permissions`, and CapabilityIngress together with ToolSystem uniformly enforce access control via Core's `canAccessTool()`.

## Post-Migration Outbound Capability Changes

QQ Endpoints declare native Markdown and keyboard support. `UserInteraction.ask()` renders confirm/select controls as Markdown buttons. Adapters without native buttons degrade the same keyboard semantics to numbered choices.

## Console page

Open the Console **QQ** page (route `/qq`) to:

- view running connections and test connectivity;
- view, edit, start, stop, replace, or remove accounts from Host runtime storage;
- scan-bind a new bot from **Platform actions**; save it disabled and start it explicitly.

Reads require `qq:read`; writes require `qq:write`, with full administrator tokens unrestricted. The first migration requires an administrator to confirm the existing account list and retains identity and history. Account changes do not rewrite startup files or `.env`. Connection updates reconnect only that account; replacement assigns a new identity without inheriting Sessions or settings. Refresh to verify an unknown commit outcome instead of retrying automatically.

## Outage notifications

When the QQ official bot is offline or fails to start, configure `notify` to alert the master through another adapter instance:

```yaml
icqq:
  # ... a configured ICQQ instance
qq:
  master: "${QQ_MASTER_OPENID}"
  notify:
    adapter: icqq
    endpoint: "123456"
    kind: private
    id: "123456"   # master QQ number
```

The notice tells the master to reply `qq endpoint add` to re-bind with a QR code, or to open the Console QQ page. `notify.id` also counts as the master identity for endpoint management commands, so the reply can come from the notified conversation. Without `notify`, only logs and the Console QQ page show connection state.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Gateway disconnects after Identify | `botKind` and intents; public bots must not request restricted intents |
| QR binding remains offline | Console login task result, App ID, Secret, and Token |
| Webhook has no events | HTTP Host, public path, callback settings, and signature parameters |
| Markdown/button fails | Platform templates and permission; degrade by Endpoint capability |

## License

MIT License

Group/channel-specific Skills and their private Tools are disclosed only in their declared scenes. Common lookup and messaging stay separate. See [Agent capabilities](../authoring/agent-tools.md) for classification.
