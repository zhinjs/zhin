---
title: "@zhin.js/adapter-telegram"
package: "@zhin.js/adapter-telegram"
tier: Advanced
---

::: info Documentation Sync
This page is auto-generated from [`plugins/adapters/telegram/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/telegram/README.md). Please edit the in-package README and then run `pnpm sync:adapter-docs`.
:::

<!-- sync-adapter-docs:sha256=a0b9238c53c55450 -->

# @zhin.js/adapter-telegram

Zhin.js Telegram Bot API adapter (Plugin Runtime). By default, it sends and receives messages via **long polling `getUpdates`** (no host required).

## Features

- Long polling `getUpdates` inbound (default; no public IP / host-http required)
- Parses text / image / video / audio / voice / document / sticker / location / callback_query
- Supports private chat and groups
- Outbound `send({ conversation, payload })` -> Bot API (text / media / keyboard)
- Convention-based `defineAdapter` / `definePlugin` (no `usePlugin` needed)
- Webhook mode deferred (requires `httpHostToken`); configuring `polling: false` will produce an explicit error

## Installation

```bash
pnpm add @zhin.js/adapter-telegram
```

## Plugin Runtime

- `@zhin.js/adapter` — convention-based `adapters/telegram.ts` (`defineAdapter`)
- `@zhin.js/core` — `messageGatewayToken` inbound/outbound
- `zhin.js` — `plugin.ts` (`definePlugin`)
- Configuration goes to `plugins.<instanceKey>` via the plugin's `schema.json`
- **Does not require** `@zhin.js/host-http` (polling path)

Inbound: `gateway.receive({ conversation, message, content, sender, metadata })` (`conversation.id` is the chatId)
Outbound: `send({ conversation, payload })` -> Telegram Bot API (chat_id is `conversation.id`)

### Platform Permissions (platform permit)

- Sender role has been restored: for group messages, inbound uses `getChatMember` (60s cache) to resolve the sender, writing to `metadata.senderRole` / `metadata.senderPermissions`.
- `plugin.ts` registers a checker during generation setup and unregisters on dispose; Plugin Runtime CapabilityIngress and ToolSystem uniformly consume `permissions` via Core's `canAccessTool()`.

## Prerequisites

| Requirement | Description |
|-------------|-------------|
| **Bot Token** | Create and obtain a Token via [@BotFather](https://t.me/botfather) |
| **Polling (default)** | Works for both local and production; actively pulls updates, no public HTTPS needed |
| **Network** | Outbound must be able to reach `api.telegram.org` |
| **host-http** | **Not needed** for Polling; Webhook deferred to next milestone |

Required fields (`endpoints[i]`): `name`, `token`.

## Minimal Configuration

```yaml
# zhin.config.yml (Plugin Runtime)
plugins:
  telegram:
    # polling: true   # default
    endpoints:
      - name: my-telegram-bot
        token: ${TELEGRAM_TOKEN}
```

The root plugin `zhin.plugins` (or project graph) must reference `@zhin.js/adapter-telegram` (`instanceKey: telegram`).

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TELEGRAM_TOKEN` / `TELEGRAM_BOT_TOKEN` | Bot Token |
| `TELEGRAM_BOT_NAME` | Optional, default endpoint name |

## Webhook (deferred)

`polling: false` + `webhook` currently throws an explicit error:

> Telegram webhook mode is deferred until httpHostToken wiring; use polling: true (default) for now

The next milestone will register a POST route via `httpHostToken`, instead of using Telegraf's self-hosted listener or the legacy host-router.

## Message Type Mapping

| Telegram | Inbound content (text summary) | Outbound wire |
|----------|-------------------------------|---------------|
| text | Original text | sendMessage |
| photo | `[image]` / caption | sendPhoto (`file_id` / `url`) |
| video | `[video]` | sendVideo |
| audio / voice | `[audio]` / `[voice]` | sendAudio / sendVoice |
| document | `[file: name]` | sendDocument |
| sticker | `[sticker: ...]` | sendSticker |
| location | `[location: lat,lon]` | sendLocation |
| callback_query | `[action: data]` | — |

## AI Tools

| Kind | Path |
|------|------|
| Platform tools (10) | `agent/tools/` (invite / pin / admins / sticker / poll, etc.) |
| Skill doc | `agent/skills/telegram.md` |

## Troubleshooting

| Symptom | Investigation |
|---------|---------------|
| Not receiving messages | Check if the token is correct; ensure the process has called `open()`; do not run multiple processes polling with the same token |
| Polling errors | Check if `api.telegram.org` is reachable; review logs for `op: poll` |
| Webhook configuration error | Only polling is currently supported; remove `polling: false` |
| Send failure | Check if the token has been revoked; review the Bot API error description |

## Documentation

- [Telegram adapter on zhin.js.org](https://zhin.js.org/adapters/telegram)
- [Adapters overview](https://zhin.js.org/essentials/adapters)

## License

MIT
