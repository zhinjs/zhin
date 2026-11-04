---
title: "@zhin.js/adapter-telegram"
package: "@zhin.js/adapter-telegram"
tier: Advanced
---

::: info Documentation Sync
This page translates [`plugins/adapters/telegram/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/telegram/README.md). Keep this English page aligned with the README; `pnpm sync:adapter-docs` updates the Chinese pages.
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

The owning `Adapter` manages desired accounts and running incarnations. The actual SDK or protocol Client implements structural `Endpoint`; framework hooks use `endpointSpec` without replacing native SDK APIs. Complete accepted callbacks enter through `events.run(...)` before deduplication and asynchronous normalization; see [Adapter authoring](/en/authoring/adapters).

- `@zhin.js/adapter` — convention-based `adapters/telegram/index.ts` (`defineAdapter`)
- `@zhin.js/core` — `endpoint[endpointSpec].events.emit(...)` inbound, `outboundMessageToken` outbound
- `zhin.js` — `plugin.ts` (`definePlugin`)
- Configuration goes to the top-level `<instanceKey>` block via the plugin's `schema.json`
- **Does not require** `@zhin.js/host-http` (polling path)

Inbound: `endpoint[endpointSpec].events.emit('message.receive', { conversation, message, content, sender, metadata })` (`conversation.id` is the chatId)
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
configVersion: 2
# zhin.config.yml (Plugin Runtime)
plugins:
  telegram: "@zhin.js/adapter-telegram"
telegram:
  # polling: true   # default
  endpoints:
    - name: my-telegram-bot
      token: ${TELEGRAM_TOKEN}
```

The root plugin the main configuration `plugins` map (or project graph) must reference `@zhin.js/adapter-telegram` (`instanceKey: telegram`).

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
| Platform tools (10) | `tools/` (invite / pin / admins / sticker / poll, etc.) |
| Skill doc | `agents/telegram/skills/telegram-chat-admin/SKILL.md`, `agents/telegram/skills/telegram-messages/SKILL.md` |

## Console page

Open the Console **Telegram** page (route `/telegram`) to:

- view running connections and test connectivity;
- add, edit, start, stop, replace, or remove accounts through Host runtime storage; startup configuration and `.env` remain unchanged;
- complete LoginAssist tasks (QR code, slider or device confirmation) when the adapter asks for a login;

An administrator must review and confirm the existing account list before its first migration; identity and history are retained. New or replaced accounts are saved disabled and must be started explicitly. A connection update reconnects only that account; replacement uses a new internal identity and does not inherit Sessions or settings. If a commit outcome is unknown, refresh to verify it before taking another action.

Reading requires `telegram:read`; writes require `telegram:write`. A full admin token is unrestricted. "Add endpoint" is equivalent to the old `telegram endpoint add` command.

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

### Disabled buttons

Canonical keyboard buttons with `disabled: true` map to Telegram Bot API 10.3 `disabled: {}` and omit `callback_data`. Enabled buttons retain their callback payload and the 1–64 UTF-8 byte validation. A self-hosted Bot API Server must support this version; see [DisabledButton](https://core.telegram.org/bots/api#disabledbutton).
