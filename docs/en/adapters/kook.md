---
title: "@zhin.js/adapter-kook"
package: "@zhin.js/adapter-kook"
tier: Advanced
---

::: info Documentation Sync
This page is auto-generated from [`plugins/adapters/kook/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/kook/README.md). Please edit the in-package README and then run `pnpm sync:adapter-docs`.
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

- `@zhin.js/adapter` — convention-based `adapters/kook.ts` (`defineAdapter`)
- `@zhin.js/core` — `messageGatewayToken` inbound/outbound
- `@zhin.js/host-http` — Webhook mode POST route (not needed for WebSocket)
- `zhin.js` — `plugin.ts` (`definePlugin`)
- Configuration goes to `plugins.<instanceKey>` via the plugin's `schema.json`
- **WebSocket path does not require** `@zhin.js/host-http` / `@zhin.js/host-router`

Inbound: `gateway.receive({ conversation, message, content, sender, metadata })` (`kind: 'channel'` carries the guild in `parent`)
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
# zhin.config.yml (Plugin Runtime)
plugins:
  kook:
    # connection: websocket   # default
    endpoints:
      - name: my-kook-bot
        token: ${KOOK_TOKEN}
```

The root plugin `zhin.plugins` (or project graph) must reference `@zhin.js/adapter-kook` (`instanceKey: kook`).

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
plugins:
  kook:
    connection: webhook
    webhookPath: /kook/webhook
    endpoints:
      - name: my-kook-bot
        token: ${KOOK_TOKEN}
        verify_token: ${KOOK_VERIFY_TOKEN}
        # encrypt_key: ${KOOK_ENCRYPT_KEY}   # Required when message encryption is enabled
```

The Host must inject `httpHostToken`. The Challenge (`type: 255`) validates `verify_token` and echoes back the `challenge`; regular events are received via `gateway.receive`, while outbound still uses the KOOK HTTP API.

## AI Tools (Skill)

| Category | Path |
|----------|------|
| Permit vocabulary | `agent/PERMITS.md` |
| Platform tools | `agent/tools/` (roles, blocklist, etc.) |
| Skill documentation | `agent/skills/kook.md` |

## Platform Permissions (platform permit)

The platform permit checker is registered by the `plugin.ts` generation lifecycle; CapabilityIngress and ToolSystem uniformly consume a tool's platform permit declarations via Core's `canAccessTool()`.

## Post-Migration Outbound Capability Changes

After migrating to Plugin Runtime, outbound messages are uniformly rendered to text via `messageGatewayToken` before sending (`sendChannelMsg` / `sendPrivateMsg`, KMarkdown text). The old Adapter's rich media outbound capabilities (images / card messages / attachments and other multi-modal segment direct sends) have not yet been migrated — current outbound is equivalent to plain text (KMarkdown). For sending cards or attachments, you can directly use the KOOK OpenAPI wrappers on the endpoint (same client as `getRoleList`, etc.) as an escape hatch.

## License

MIT License
