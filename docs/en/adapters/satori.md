---
title: "@zhin.js/adapter-satori"
package: "@zhin.js/adapter-satori"
tier: Experimental
---

::: info Documentation Sync
This page translates [`plugins/adapters/satori/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/satori/README.md). Keep this English page aligned with the README; `pnpm sync:adapter-docs` updates the Chinese pages.
:::

<!-- sync-adapter-docs:sha256=c700b782d7d3ce67 -->

# @zhin.js/adapter-satori

Zhin.js [Satori](https://satori.chat/zh-CN/introduction.html) **chat protocol** adapter (Plugin Runtime). Supports **forward WebSocket client** (`connection: ws`) and **Webhook inbound** (`connection: webhook`, POST route via `httpHostToken`).

> Satori is a chat protocol. Image rendering uses `@zhin.js/html-renderer` (`@pixel.js/shotium`) and is independent of this adapter.

## Features

- [Satori protocol](https://satori.chat/zh-CN/introduction.html) compatible
- **Forward WebSocket** (`connection: ws`, default): the application connects to the SDK at `ws(s)://baseUrl`, IDENTIFY + heartbeat
- Bearer Token authentication (API and WS IDENTIFY)
- Channel / private chat message send/receive, message id format is `channelId:messageId`
- Convention-based `defineAdapter` / `definePlugin` (no `usePlugin` needed)
- **Webhook** (`connection: webhook`): the SDK sends POST with `Satori-Opcode: 0` events to `path`

## Installation

```bash
pnpm add @zhin.js/adapter-satori
```

## Plugin Runtime

The owning `Adapter` manages desired accounts and running incarnations. The actual SDK or protocol Client implements structural `Endpoint`; framework hooks use `endpointSpec` without replacing native SDK APIs. Complete accepted callbacks enter through `events.run(...)` before deduplication and asynchronous normalization; see [Adapter authoring](/en/authoring/adapters).

- `@zhin.js/adapter` — convention-based `adapters/satori/index.ts` (`defineAdapter`)
- `@zhin.js/core` — `endpoint[endpointSpec].events.emit(...)` inbound, `outboundMessageToken` outbound
- `zhin.js` — `plugin.ts` (`definePlugin`)
- `@zhin.js/host-http` — Webhook mode requires `httpHostToken` to register POST route
- Configuration goes to the top-level `<instanceKey>` block via the plugin's `schema.json` (`baseUrl` / `token` / ...)

Inbound: `endpoint[endpointSpec].events.emit('message.receive', { conversation, message, content, sender, metadata })` (`conversation.id` is the channelId; guild lands in `parent`)
Outbound: `send({ conversation, payload })` -> Satori `message.create` (`channel_id` is `conversation.id`; payload is rendered by gateway/core; no segment-mapper)

Inbound `metadata.mentioned`: set to `true` when the id of an `<at id="..."/>` element in the message content equals the login selfId (from READY/event `login.user.id`).

## Prerequisites

1. Prepare a compatible Satori server and record its API base, platform identity, and user identity.
2. Zhin must reach Satori for forward WS; Satori must reach the Zhin HTTP Host for Webhooks.
3. When authentication is enabled, configure the same Bearer token on both sides.

## Minimal Configuration

```yaml
configVersion: 2
# zhin.config.yml (Plugin Runtime)
plugins:
  satori: "@zhin.js/adapter-satori"
satori:
  connection: ws
  heartbeat_interval: 10000
  endpoints:
    - id: satori-bot
      platform: qq
      userId: "123456789"
      baseUrl: "http://127.0.0.1:5140"
      token: "${SATORI_TOKEN}"
```

The root plugin the main configuration `plugins` map (or project graph) must reference `@zhin.js/adapter-satori` (`instanceKey: satori`).

### Endpoint Fields

| Field | Description |
|-------|-------------|
| `heartbeat_interval` | WS PING interval (milliseconds), default `10000` |
| `platform` | Required remote login platform |
| `userId` | Required remote login user identity (string) |
| `token` | Bearer; YAML may reference `${SATORI_TOKEN}` |

### Webhook

```yaml
configVersion: 2
plugins:
  satori: "@zhin.js/adapter-satori"
satori:
  connection: webhook
  endpoints:
    - id: satori-bot
      platform: qq
      userId: "123456789"
      baseUrl: "http://127.0.0.1:5140"
      path: "/satori/webhook"
      token: "${SATORI_TOKEN}"
```

The SDK sends POST requests to `path`, with header `Satori-Opcode: 0` indicating events; each Endpoint must configure `platform` and `userId`. Only events with an exactly matching login are admitted, and API requests use that same fixed identity. Other logins in READY do not change the selected account.

## Authentication

- **API**: request header `Authorization: Bearer {token}`
- **WebSocket**: `token` is passed in the IDENTIFY body

## Message ID and Recall

- Message id format is `channelId:messageId`, making it easy to parse when sending messages or recalling.
- Recall requires `channel_id` + `message_id`; the adapter parses them from the format described above.

## AI Tools

See `skills/satori/SKILL.md` for skill documentation.

## Protocol Documentation

- [Introduction](https://satori.chat/zh-CN/introduction.html)
- [Overview](https://satori.chat/zh-CN/protocol/overview.html)
- [API](https://satori.chat/zh-CN/protocol/api.html)

## Console page

Open the Console **Satori** page (route `/satori`) to:

- view running connections and test connectivity;
- add, edit, start, stop, replace, or remove accounts through Host runtime storage; startup configuration and `.env` remain unchanged;
- complete LoginAssist tasks (QR code, slider or device confirmation) when the adapter asks for a login;

An administrator must review and confirm the existing account list before its first migration; identity and history are retained. New or replaced accounts are saved disabled and must be started explicitly. A connection update reconnects only that account; replacement uses a new internal identity and does not inherit Sessions or settings. If a commit outcome is unknown, refresh to verify it before taking another action.

Reading requires `satori:read`; writes require `satori:write`. A full admin token is unrestricted. "Add endpoint" is equivalent to the old `satori endpoint add` command.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| WS IDENTIFY fails | `baseUrl`, platform/user identity, and token |
| Webhook has no events | Path, `Satori-Opcode: 0`, and HTTP Host |
| 401 | Matching token across API, WS IDENTIFY, and Webhook |
| Wrong send target | `channel_id` and Conversation kind; only DIRECT maps to private |
