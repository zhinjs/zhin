---
title: "@zhin.js/adapter-lark"
package: "@zhin.js/adapter-lark"
tier: Advanced
---

::: info Documentation Sync
This page is auto-generated from [`plugins/adapters/lark/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/lark/README.md). Please edit the in-package README and then run `pnpm sync:adapter-docs`.
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

- `@zhin.js/adapter` — convention-based `adapters/lark.ts` (`defineAdapter`)
- `@zhin.js/core` — `messageGatewayToken` inbound/outbound
- `@zhin.js/host-http` — `httpHostToken` registers Webhook route (**not** legacy host-router/Koa)
- `zhin.js` — `plugin.ts` (`definePlugin`)
- Configuration goes to `plugins.<instanceKey>` via the plugin's `schema.json`

Inbound: `gateway.receive({ conversation, message, content, sender, metadata })` (`conversation.id` is the chat_id)
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
# zhin.config.yml (Plugin Runtime)
plugins:
  lark:
    webhookPath: /lark/webhook          # optional, default /lark/webhook
    isFeishu: true                      # optional, default true
    # apiBaseUrl: https://open.feishu.cn/open-apis
    endpoints:
      - name: my-lark-bot
        appId: ${LARK_APP_ID}
        appSecret: ${LARK_APP_SECRET}
        # encryptKey: ${LARK_ENCRYPT_KEY}          # optional
        # verificationToken: ${LARK_VERIFY_TOKEN}  # optional
```

The root plugin `zhin.plugins` (or project graph) must reference `@zhin.js/adapter-lark` (`instanceKey: lark`).

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

The `agent/` directory is retained (get_user, group chat, administrators, file upload, etc.). The Endpoint self-registers to `lark-agent-deps` at `start`.

## Platform Permissions (platform permit)

`plugin.ts` registers the `src/platform-permit.ts` checker during generation setup and unregisters on dispose; CapabilityIngress and ToolSystem uniformly consume tool permissions via Core's `canAccessTool()`.

## Testing

```bash
pnpm --filter @zhin.js/adapter-lark build
pnpm --filter @zhin.js/adapter-lark test
```
