---
title: "@zhin.js/adapter-satori"
package: "@zhin.js/adapter-satori"
tier: Experimental
---

::: info Documentation Sync
This page is auto-generated from [`plugins/adapters/satori/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/satori/README.md). Please edit the in-package README and then run `pnpm sync:adapter-docs`.
:::

<!-- sync-adapter-docs:sha256=c700b782d7d3ce67 -->

# @zhin.js/adapter-satori

Zhin.js [Satori](https://satori.chat/zh-CN/introduction.html) **chat protocol** adapter (Plugin Runtime). Supports **forward WebSocket client** (`connection: ws`) and **Webhook inbound** (`connection: webhook`, POST route via `httpHostToken`).

> **Do not confuse with `@zhin.js/satori`**: the latter is a [Vercel satori](https://github.com/vercel/satori) **SVG image rendering** toolkit (`packages/toolkit/satori`), used to render HTML/React as SVG. It is **not** a chat protocol. See [@zhin.js/satori README](https://github.com/zhinjs/zhin/tree/main/packages/toolkit/satori).

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

- `@zhin.js/adapter` — convention-based `adapters/satori.ts` (`defineAdapter`)
- `@zhin.js/core` — `messageGatewayToken` inbound/outbound
- `zhin.js` — `plugin.ts` (`definePlugin`)
- `@zhin.js/host-http` — Webhook mode requires `httpHostToken` to register POST route
- Configuration goes to `plugins.<instanceKey>` via the plugin's `schema.json` (`baseUrl` / `token` / ...)

Inbound: `gateway.receive({ conversation, message, content, sender, metadata })` (`conversation.id` is the channelId; guild lands in `parent`)
Outbound: `send({ conversation, payload })` -> Satori `message.create` (`channel_id` is `conversation.id`; payload is rendered by gateway/core; no segment-mapper)

Inbound `metadata.mentioned`: set to `true` when the id of an `<at id="..."/>` element in the message content equals the login selfId (from READY/event `login.user.id`).

## Prerequisites

1. Prepare a compatible Satori server and record its API base, platform identity, and user identity.
2. Zhin must reach Satori for forward WS; Satori must reach the Zhin HTTP Host for Webhooks.
3. When authentication is enabled, configure the same Bearer token on both sides.

## Minimal Configuration

```yaml
# zhin.config.yml (Plugin Runtime)
plugins:
  satori:
    connection: ws
    heartbeat_interval: 10000
    endpoints:
      - name: satori-bot
        baseUrl: "http://127.0.0.1:5140"
        token: "${SATORI_TOKEN}"
```

The root plugin `zhin.plugins` (or project graph) must reference `@zhin.js/adapter-satori` (`instanceKey: satori`).

### Optional Fields

| Field | Description |
|-------|-------------|
| `heartbeat_interval` | WS PING interval (milliseconds), default `10000` |
| `token` | Bearer; can also be set via the `SATORI_TOKEN` environment variable |

### Webhook

```yaml
plugins:
  satori:
    connection: webhook
    endpoints:
      - name: satori-bot
        baseUrl: "http://127.0.0.1:5140"
        path: "/satori/webhook"
        token: "${SATORI_TOKEN}"
```

The SDK sends POST requests to `path`, with header `Satori-Opcode: 0` indicating events; the adapter obtains the platform / userId from the `login` in the first event for subsequent API calls.

## Authentication

- **API**: request header `Authorization: Bearer {token}`
- **WebSocket**: `token` is passed in the IDENTIFY body

## Message ID and Recall

- Message id format is `channelId:messageId`, making it easy to parse when sending messages or recalling.
- Recall requires `channel_id` + `message_id`; the adapter parses them from the format described above.

## AI Tools

See `agent/skills/satori.md` for skill documentation.

## Protocol Documentation

- [Introduction](https://satori.chat/zh-CN/introduction.html)
- [Overview](https://satori.chat/zh-CN/protocol/overview.html)
- [API](https://satori.chat/zh-CN/protocol/api.html)

## Troubleshooting

| Symptom | Check |
| --- | --- |
| WS IDENTIFY fails | `baseUrl`, platform/user identity, and token |
| Webhook has no events | Path, `Satori-Opcode: 0`, and HTTP Host |
| 401 | Matching token across API, WS IDENTIFY, and Webhook |
| Wrong send target | `channel_id` and Conversation kind; only DIRECT maps to private |
