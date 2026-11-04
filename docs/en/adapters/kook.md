---
title: "@zhin.js/adapter-kook"
package: "@zhin.js/adapter-kook"
tier: Advanced
---

::: info Documentation Sync
This page translates [`plugins/adapters/kook/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/kook/README.md). Keep this English page aligned with the README; `pnpm sync:adapter-docs` updates the Chinese pages.
:::

<!-- sync-adapter-docs:sha256=c41f6b275a7c318d -->

# @zhin.js/adapter-kook

Zhin.js KOOK adapter (Plugin Runtime). By default, it sends and receives messages via the **WebSocket Gateway** (`kook-client`); optionally supports **Webhook** mode to receive platform POST pushes via `httpHostToken`.

## Features

- WebSocket Gateway inbound (default; no public HTTPS / host required)
- Webhook inbound (`connection: webhook` + `httpHostToken` + `verify_token`)
- Parses channel and private chat text messages
- Outbound `send({ conversation, payload })` -> KOOK KMarkdown (`kind: 'channel' | 'private'`, `conversation.id` is the channel/user id)
- Convention-based `defineAdapter` / `definePlugin` (no `usePlugin` needed)

## Installation

```bash
pnpm add @zhin.js/adapter-kook
```

## Plugin Runtime

The owning `Adapter` manages desired accounts and running incarnations. The actual SDK or protocol Client implements structural `Endpoint`; framework hooks use `endpointSpec` without replacing native SDK APIs. Complete accepted callbacks enter through `events.run(...)` before deduplication and asynchronous normalization; see [Adapter authoring](/en/authoring/adapters).

- `@zhin.js/adapter` — convention-based `adapters/kook/index.ts` (`defineAdapter`)
- `@zhin.js/core` — `endpoint[endpointSpec].events.emit(...)` inbound, `outboundMessageToken` outbound
- `@zhin.js/host-http` — Webhook mode POST route (not needed for WebSocket)
- `zhin.js` — `plugin.ts` (`definePlugin`)
- Configuration goes to the top-level `<instanceKey>` block via the plugin's `schema.json`
- **WebSocket path does not require** `@zhin.js/host-http` / `@zhin.js/host-router`

Inbound: `endpoint[endpointSpec].events.emit('message.receive', { conversation, message, content, sender, metadata })` (`kind: 'channel'` carries the guild in `parent`)
Outbound: `send({ conversation, payload })` -> `sendChannelMsg` / `sendPrivateMsg`

## Prerequisites

| Requirement | Description |
|-------------|-------------|
| **Bot Token** | Create an application on the [KOOK Developer Platform](https://developer.kookapp.cn/) and obtain one |
| **Invite to server** | Invite the bot to the target server and grant permissions such as view channels and send messages |
| **WebSocket (default)** | `kook-client` forward connection; no public URL needed |
| **Webhook** | Requires public HTTPS + Host `httpHostToken`; mutually exclusive with WebSocket |
| **host-http** | Only needed for Webhook mode |

Required fields (`endpoints[i]`): `name`, `token`.

## Minimal Configuration

```yaml
configVersion: 2
# zhin.config.yml (Plugin Runtime)
plugins:
  kook: "@zhin.js/adapter-kook"
kook:
  # connection: websocket   # default
  endpoints:
    - name: my-kook-bot
      token: ${KOOK_TOKEN}
```

The root plugin the main configuration `plugins` map (or project graph) must reference `@zhin.js/adapter-kook` (`instanceKey: kook`).

## Environment Variables

| Variable | Description |
|----------|-------------|
| `KOOK_TOKEN` / `KOOK_BOT_TOKEN` | Bot Token |
| `KOOK_BOT_NAME` | Optional, default endpoint name |
| `KOOK_VERIFY_TOKEN` | Webhook mode verify token |
| `KOOK_ENCRYPT_KEY` | Optional, Webhook message encryption key |
| `KOOK_WEBHOOK_PATH` | Optional, default `/kook/webhook` |

## Webhook

In the KOOK developer dashboard, select the **WebHook** connection mode and point the Callback URL to the public address exposed by the Host (adding `?compress=0` to the URL is recommended for easier debugging).

```yaml
configVersion: 2
plugins:
  kook: "@zhin.js/adapter-kook"
kook:
  connection: webhook
  webhookPath: /kook/webhook
  endpoints:
    - name: my-kook-bot
      token: ${KOOK_TOKEN}
      verify_token: ${KOOK_VERIFY_TOKEN}
      # encrypt_key: ${KOOK_ENCRYPT_KEY}   # Required when message encryption is enabled
```

The Host must inject `httpHostToken`. The Challenge (`type: 255`) validates `verify_token` and echoes back the `challenge`; regular events are received via `endpoint[endpointSpec].events.emit`, while outbound still uses the KOOK HTTP API.

## AI Tools (Skill)

| Category | Path |
|----------|------|
| Permit vocabulary | `PERMITS.md` |
| Platform tools | `tools/` (roles, blocklist, etc.) |
| Skill documentation | `agents/kook/skills/kook/SKILL.md` |

## Platform Permissions (platform permit)

The platform permit checker is registered by the `plugin.ts` generation lifecycle; CapabilityIngress and ToolSystem uniformly consume a tool's platform permit declarations via Core's `canAccessTool()`.

## Post-Migration Outbound Capability Changes

Outbound uses `outboundMessageToken` and encodes canonical Markdown as KMarkdown. Remote media URLs can be represented as links. Card messages and attachment upload are not yet part of the unified outbound path.

## Console page

Open the Console **KOOK** page (route `/kook`) to:

- view running connections and test connectivity;
- add, edit, start, stop, replace, or remove accounts through Host runtime storage; startup configuration and `.env` remain unchanged;
- complete LoginAssist tasks (QR code, slider or device confirmation) when the adapter asks for a login;

An administrator must review and confirm the existing account list before its first migration; identity and history are retained. New or replaced accounts are saved disabled and must be started explicitly. A connection update reconnects only that account; replacement uses a new internal identity and does not inherit Sessions or settings. If a commit outcome is unknown, refresh to verify it before taking another action.

Reading requires `kook:read`; writes require `kook:write`. A full admin token is unrestricted. "Add endpoint" is equivalent to the old `kook endpoint add` command.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| WebSocket cannot connect | Bot Token, network, and bot capability switch |
| Webhook challenge fails | Public path, `verify_token`, and HTTP Host |
| Channel event does not arrive | Subscription, channel permissions, and bot membership |
| Attachment becomes a link | Unified outbound does not upload attachments; use a remote URL or degrade |

## License

MIT License
