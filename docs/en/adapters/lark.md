---
title: "@zhin.js/adapter-lark"
package: "@zhin.js/adapter-lark"
tier: Advanced
---

::: info Documentation Sync
This page translates [`plugins/adapters/lark/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/lark/README.md). Keep this English page aligned with the README; `pnpm sync:adapter-docs` updates the Chinese pages.
:::

<!-- sync-adapter-docs:sha256=88ee48e5390fd4ab -->

# @zhin.js/adapter-lark

Zhin.js Lark (Feishu) adapter (Plugin Runtime). Sends and receives messages via the Runtime Host HTTP Webhook.

## Features

- Webhook event reception (`httpHostToken` POST + optional verificationToken / encryptKey signature)
- URL verification challenge (`url_verification`)
- Automatic Tenant Access Token refresh
- Supports both Feishu and Lark international edition API base URLs
- Convention-based `defineAdapter` / `definePlugin` (no `usePlugin` needed)

## Installation

```bash
pnpm add @zhin.js/adapter-lark
```

## Plugin Runtime

The owning `Adapter` manages desired accounts and running incarnations. The actual SDK or protocol Client implements structural `Endpoint`; framework hooks use `endpointSpec` without replacing native SDK APIs. Complete accepted callbacks enter through `events.run(...)` before deduplication and asynchronous normalization; see [Adapter authoring](/en/authoring/adapters).

- `@zhin.js/adapter` — convention-based `adapters/lark/index.ts` (`defineAdapter`)
- `@zhin.js/core` — `endpoint[endpointSpec].events.emit(...)` inbound, `outboundMessageToken` outbound
- `@zhin.js/host-http` — `httpHostToken` registers Webhook route (**not** legacy host-router/Koa)
- `zhin.js` — `plugin.ts` (`definePlugin`)
- Configuration goes to the top-level `<instanceKey>` block via the plugin's `schema.json`

Inbound: `endpoint[endpointSpec].events.emit('message.receive', { conversation, message, content, sender, metadata })` (`conversation.id` is the chat_id)
Outbound: `send({ conversation, payload })` -> `im/v1/messages` (`receive_id` is `conversation.id`)

Inbound `metadata.mentioned`: **not wired**. The message event's `mentions[]` elements contain `id.open_id`, but this adapter cannot obtain the bot's own open_id -- the configuration (`appId` / `appSecret` / `name`, etc.) does not include the bot open_id, and the code does not call `bot/v3/info` to get application info, so there is no reliable basis for comparing mentions.

## Prerequisites

1. Create an enterprise self-built application on the [Feishu Open Platform](https://open.feishu.cn/) (or Lark)
2. Obtain **App ID** and **App Secret**
3. Enable bot capabilities and configure the event subscription URL: `https://your-domain/lark/webhook`
4. The Runtime Host (`http`) must already be listening for the Webhook to be reachable

Required fields (`endpoints[i]`): `name`, `appId`, `appSecret`.

## Minimal Configuration

```yaml
configVersion: 2
# zhin.config.yml (Plugin Runtime)
plugins:
  lark: "@zhin.js/adapter-lark"
lark:
  webhookPath: /lark/webhook # optional, default /lark/webhook
  isFeishu: true # optional, default true
  # apiBaseUrl: https://open.feishu.cn/open-apis
  endpoints:
    - name: my-lark-bot
      appId: ${LARK_APP_ID}
      appSecret: ${LARK_APP_SECRET}
      # encryptKey: ${LARK_ENCRYPT_KEY}          # optional
      # verificationToken: ${LARK_VERIFY_TOKEN}  # optional
```

The root plugin the main configuration `plugins` map (or project graph) must reference `@zhin.js/adapter-lark` (`instanceKey: lark`).

## Environment Variables

| Variable | Description |
|----------|-------------|
| `LARK_APP_ID` | Application App ID |
| `LARK_APP_SECRET` | Application App Secret |
| `LARK_BOT_NAME` | Default endpoint name (optional) |

## Message Type Mapping

| Lark Type | Inbound content (text summary) | Outbound wire |
|-----------|-------------------------------|---------------|
| text | Original text | text |
| image | `[image]` | image (requires `file_key`) |
| file | `[file: name]` | file |
| audio / video / sticker | `[audio]` / `[video]` / `[sticker]` | — |
| card | — | interactive |

## Agent Tools

The `agents/lark/skills/` directories provide get_user, group chat, administrator, file upload, and related Tools. A tool declaring `adapter: 'lark'` lazily receives the current operation's `LarkClient` through `context.$client`; the model no longer selects an Endpoint id.

## Platform Permissions (platform permit)

`plugin.ts` registers the `src/platform-permit.ts` checker during generation setup and unregisters on dispose; CapabilityIngress and ToolSystem uniformly consume tool permissions via Core's `canAccessTool()`.

## Testing

```bash
pnpm --filter @zhin.js/adapter-lark build
pnpm --filter @zhin.js/adapter-lark test
```

## Console page

Open the Console **Lark** page (route `/lark`) to:

- view running connections and test connectivity;
- add, edit, start, stop, replace, or remove accounts through Host runtime storage; startup configuration and `.env` remain unchanged;
- complete LoginAssist tasks (QR code, slider or device confirmation) when the adapter asks for a login;

An administrator must review and confirm the existing account list before its first migration; identity and history are retained. New or replaced accounts are saved disabled and must be started explicitly. A connection update reconnects only that account; replacement uses a new internal identity and does not inherit Sessions or settings. If a commit outcome is unknown, refresh to verify it before taking another action.

Reading requires `lark:read`; writes require `lark:write`. A full admin token is unrestricted. "Add endpoint" is equivalent to the old `lark endpoint add` command.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| URL verification fails | Public HTTPS, `webhookPath`, verification token, and encrypt key |
| Tenant Token fails | `appId`, `appSecret`, and whether the App version is published |
| @bot does not trigger AI | Bot open_id cannot yet be identified reliably; use an explicit AI prefix |
| Receives but cannot send | Message permission, visibility range, and chat membership |

Existing-group administration is in `lark-group-admin`, disclosed only in group conversations. User lookup, creating a group and other common operations remain separate.
