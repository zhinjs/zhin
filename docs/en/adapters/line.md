---
title: "@zhin.js/adapter-line"
package: "@zhin.js/adapter-line"
tier: Experimental
---

::: info Documentation Sync
This page translates [`plugins/adapters/line/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/line/README.md). Keep this English page aligned with the README; `pnpm sync:adapter-docs` updates the Chinese pages.
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

The owning `Adapter` manages desired accounts and running incarnations. The actual SDK or protocol Client implements structural `Endpoint`; framework hooks use `endpointSpec` without replacing native SDK APIs. Complete accepted callbacks enter through `events.run(...)` before deduplication and asynchronous normalization; see [Adapter authoring](/en/authoring/adapters).

- `@zhin.js/adapter` — convention-based `adapters/line/index.ts` (`defineAdapter`)
- `@zhin.js/core` — `endpoint[endpointSpec].events.emit(...)` inbound, `outboundMessageToken` outbound
- `@zhin.js/host-http` — `httpHostToken` registers Webhook route (**not** legacy host-router/Koa)
- `zhin.js` — `plugin.ts` (`definePlugin`)
- Configuration goes to the top-level `<instanceKey>` block via the plugin's `schema.json`

Inbound: `endpoint[endpointSpec].events.emit('message.receive', { conversation, message, content, sender, metadata })` (`conversation.id` is the user/group/room id)
Outbound: `send({ conversation, payload })` -> Reply API (cached replyToken) or Push API (recipient is `conversation.id`)

## Prerequisites

1. Create a Messaging API Channel on the [LINE Developers Console](https://developers.line.biz/)
2. Obtain **Channel Secret** and **Channel Access Token**
3. Set the Webhook URL to `https://your-domain/line/webhook`
4. Enable **Use webhooks** in the Console and disable **Auto-reply messages**
5. The Runtime Host (`http`) must already be listening for the Webhook to be reachable

Required fields (`endpoints[i]`): `name`, `channelSecret`, `channelAccessToken`.

## Minimal Configuration

```yaml
configVersion: 2
# zhin.config.yml (Plugin Runtime)
plugins:
  line: "@zhin.js/adapter-line"
line:
  webhookPath: /line/webhook # optional, default /line/webhook
  apiBaseUrl: https://api.line.me # optional, can be changed to LINE API sandbox address for debugging
  endpoints:
    - name: my-line-bot
      channelSecret: ${LINE_CHANNEL_SECRET}
      channelAccessToken: ${LINE_CHANNEL_ACCESS_TOKEN}
```

The root plugin the main configuration `plugins` map (or project graph) must reference `@zhin.js/adapter-line` (`instanceKey: line`).

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
| Permit vocabulary | `PERMITS.md` |
| Platform tools (2) | `tools/` (`line_get_profile`, `line_get_group_members`) |
| Skill documentation | `agents/line/skills/line/SKILL.md`、`agents/line/skills/line-group-directory/SKILL.md` |

## Known Limitations

- **Message recall not supported**: The LINE Messaging API does not provide an interface to recall sent messages
- **Images/video/audio**: Received media messages only contain message_id; downloading via the Content API is not yet implemented
- **Maximum 5 messages per request**: LINE limits Reply/Push to at most 5 messages per request
- **Text length limit**: A single text message can have at most 5000 characters

## Console page

Open the Console **LINE** page (route `/line`) to:

- view running connections and test connectivity;
- add, edit, start, stop, replace, or remove accounts through Host runtime storage; startup configuration and `.env` remain unchanged;
- complete LoginAssist tasks (QR code, slider or device confirmation) when the adapter asks for a login;

An administrator must review and confirm the existing account list before its first migration; identity and history are retained. New or replaced accounts are saved disabled and must be started explicitly. A connection update reconnects only that account; replacement uses a new internal identity and does not inherit Sessions or settings. If a commit outcome is unknown, refresh to verify it before taking another action.

Reading requires `line:read`; writes require `line:write`. A full admin token is unrestricted. "Add endpoint" is equivalent to the old `line endpoint add` command.

## Troubleshooting

| Issue | Investigation |
|-------|---------------|
| Webhook Verify fails | Check HTTPS certificate, domain resolution, and port reachability; confirm host-http is listening |
| Signature verification 403 | Confirm Channel Secret matches the Console |
| Send 401 | Confirm Channel Access Token has not expired |
| Send 400 | Check if the message format conforms to the LINE API specification |
| Events not arriving | Check if Webhook is enabled in the Console and Auto-reply is disabled |

Group/channel-specific Skills and their private Tools are disclosed only in their declared scenes. Common lookup and messaging stay separate. See [Agent capabilities](../authoring/agent-tools.md) for classification.
