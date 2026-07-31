---
title: "@zhin.js/adapter-line"
package: "@zhin.js/adapter-line"
tier: Experimental
---

::: info Documentation Sync
This page is auto-generated from [`plugins/adapters/line/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/line/README.md). Please edit the in-package README and then run `pnpm sync:adapter-docs`.
:::

<!-- sync-adapter-docs:sha256=3fbe6c1bad4a0704 -->

# @zhin.js/adapter-line

Zhin.js LINE Messaging API adapter (Plugin Runtime). Sends and receives messages via the Runtime Host HTTP Webhook.

## Features

- Webhook event reception (`httpHostToken` POST + HMAC-SHA256 signature verification)
- Parses text / image / video / audio / file / location / sticker
- Supports private chat, groups, and multi-person chat (room)
- Reply API (when replyToken is available) / Push API sending
- Convention-based `defineAdapter` / `definePlugin` (no `usePlugin` needed)

## Installation

```bash
pnpm add @zhin.js/adapter-line
```

## Plugin Runtime

- `@zhin.js/adapter` — convention-based `adapters/line.ts` (`defineAdapter`)
- `@zhin.js/core` — `messageGatewayToken` inbound/outbound
- `@zhin.js/host-http` — `httpHostToken` registers Webhook route (**not** legacy host-router/Koa)
- `@zhin.js/plugin-runtime` — `plugin.ts` (`definePlugin`)
- Configuration goes to `plugins.<instanceKey>` via the plugin's `schema.json`

Inbound: `gateway.receive({ adapter, target: channelId, content: text, sender, metadata })`
Outbound: `send({ target, payload })` -> Reply API (cached replyToken) or Push API

## Prerequisites

1. Create a Messaging API Channel on the [LINE Developers Console](https://developers.line.biz/)
2. Obtain **Channel Secret** and **Channel Access Token**
3. Set the Webhook URL to `https://your-domain/line/webhook`
4. Enable **Use webhooks** in the Console and disable **Auto-reply messages**
5. The Runtime Host (`http`) must already be listening for the Webhook to be reachable

Required fields (`endpoints[i]`): `name`, `channelSecret`, `channelAccessToken`.

## Minimal Configuration

```yaml
# zhin.config.yml (Plugin Runtime)
plugins:
  line:
    webhookPath: /line/webhook       # optional, default /line/webhook
    apiBaseUrl: https://api.line.me   # optional, can be changed to LINE API sandbox address for debugging
    endpoints:
      - name: my-line-bot
        channelSecret: ${LINE_CHANNEL_SECRET}
        channelAccessToken: ${LINE_CHANNEL_ACCESS_TOKEN}
```

The root plugin `zhin.plugins` (or project graph) must reference `@zhin.js/adapter-line` (`instanceKey: line`).

## Environment Variables

| Variable | Description |
|----------|-------------|
| `LINE_CHANNEL_SECRET` | Channel Secret (for signature verification) |
| `LINE_CHANNEL_ACCESS_TOKEN` | Long-lived Channel Access Token (for API calls) |

## Webhook URL Configuration

LINE requires the Webhook URL to start with HTTPS. Common approaches:

- **Reverse proxy**: Nginx/Caddy forwards `https://your-domain/line/webhook` to the local Zhin port
- **Cloudflare Tunnel**: `cloudflared tunnel --url http://localhost:port`
- **ngrok**: For debugging, `ngrok http port`

After setup, click **Verify** in the LINE Developers Console to test connectivity.

## Message Type Mapping

| LINE Type | Inbound content (text summary) | Outbound wire |
|-----------|-------------------------------|---------------|
| text | Original text | text |
| image | `[image]` | image (requires `url`) |
| video | `[video]` | video (requires `url`) |
| audio | `[audio]` | audio (requires `url`) |
| file | `[file: name]` | — |
| location | address or coordinates | location |
| sticker | `[sticker: pkg/id]` | sticker |

## AI Tools

| Category | Path |
|----------|------|
| Permit vocabulary | `agent/PERMITS.md` |
| Platform tools (2) | `agent/tools/` (`line_get_profile`, `line_get_group_members`) |
| Skill documentation | `agent/skills/line.md` |

## Known Limitations

- **Message recall not supported**: The LINE Messaging API does not provide an interface to recall sent messages
- **Images/video/audio**: Received media messages only contain message_id; downloading via the Content API is not yet implemented
- **Maximum 5 messages per request**: LINE limits Reply/Push to at most 5 messages per request
- **Text length limit**: A single text message can have at most 5000 characters

## Troubleshooting

| Issue | Investigation |
|-------|---------------|
| Webhook Verify fails | Check HTTPS certificate, domain resolution, and port reachability; confirm host-http is listening |
| Signature verification 403 | Confirm Channel Secret matches the Console |
| Send 401 | Confirm Channel Access Token has not expired |
| Send 400 | Check if the message format conforms to the LINE API specification |
| Events not arriving | Check if Webhook is enabled in the Console and Auto-reply is disabled |
