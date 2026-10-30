---
title: "@zhin.js/adapter-wecom"
package: "@zhin.js/adapter-wecom"
tier: Experimental
---

::: info Documentation Sync
This page translates [`plugins/adapters/wecom/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/wecom/README.md). Keep this English page aligned with the README; `pnpm sync:adapter-docs` updates the Chinese pages.
:::

<!-- sync-adapter-docs:sha256=f538348e1e8fbc6d -->

# @zhin.js/adapter-wecom

Zhin.js WeCom (Enterprise WeChat) adapter (Plugin Runtime). Sends and receives messages via the Runtime Host HTTP Webhook.

## Features

- Webhook event reception (`httpHostToken` GET signature verification + decryption + POST messages)
- AES-256-CBC message encryption/decryption with SHA1 signature verification
- Automatic Access Token refresh
- Convention-based `defineAdapter` / `definePlugin` (no `usePlugin` needed)

## Installation

```bash
pnpm add @zhin.js/adapter-wecom
```

## Plugin Runtime

The owning `Adapter` manages desired accounts and running incarnations. The actual SDK or protocol Client implements structural `Endpoint`; framework hooks use `endpointSpec` without replacing native SDK APIs. Complete accepted callbacks enter through `events.run(...)` before deduplication and asynchronous normalization; see [Adapter authoring](/en/authoring/adapters).

- `@zhin.js/adapter` — convention-based `adapters/wecom/index.ts` (`defineAdapter`)
- `@zhin.js/core` — `endpoint[endpointSpec].events.emit(...)` inbound, `outboundMessageToken` outbound
- `@zhin.js/host-http` — `httpHostToken` registers Webhook route (**not** legacy host-router/Koa)
- `zhin.js` — `plugin.ts` (`definePlugin`)
- Configuration goes to the top-level `<instanceKey>` block via the plugin's `schema.json`

Inbound: `endpoint[endpointSpec].events.emit('message.receive', { conversation, message, content, sender, metadata })` (`conversation.id` is FromUserName; `@chatroom` suffix means `kind: 'group'`)
Outbound: `send({ conversation, payload })` -> WeCom `message/send` API (`conversation.id` drives the chatid/touser split)

Inbound `metadata.mentioned`: **not wired**. The XML event in WeCom application message callbacks does not contain mentions/@ fields. The `ToUserName` in the callback is the CorpID (Enterprise ID) rather than a comparable bot user id, and the configuration does not contain a bot id/name that can serve as a reliable basis for comparison, so @ bot detection is not reliably possible.

## Prerequisites

### WeCom Admin Console Configuration

1. Log in to the [WeCom Admin Console](https://work.weixin.qq.com/wework_admin/frame)
2. "App Management" -> "Self-built" -> Create an application, obtain **CorpId**, **AgentId**, **Secret**
3. "Receive Messages" settings:
   - **URL**: `https://yourdomain.com/wecom/callback`
   - **Token** / **EncodingAESKey** must match the configuration
4. The Runtime Host (`http`) must already be listening for the Webhook to be reachable

Required fields (`endpoints[i]`): `id`, `corpId`, `agentId`, `agentSecret`, `token`, `encodingAESKey`.
AdapterIndex merges instance defaults into every endpoint; the protocol receives only one expanded
endpoint config.

## Minimal Configuration

```yaml
configVersion: 2
# zhin.config.yml (Plugin Runtime)
plugins:
  wecom: "@zhin.js/adapter-wecom"
wecom:
  webhookPath: /wecom/callback # optional, default /wecom/callback
  apiBaseUrl: https://qyapi.weixin.qq.com # optional
  endpoints:
    - id: wecom-bot
      corpId: ${WECOM_CORP_ID}
      agentId: "100001" # required application identity
      agentSecret: ${WECOM_AGENT_SECRET}
      token: ${WECOM_TOKEN}
      encodingAESKey: ${WECOM_AES_KEY}
```

The root plugin the main configuration `plugins` map (or project graph) must reference `@zhin.js/adapter-wecom` (`instanceKey: wecom`).

## Environment Variables

Environment variables are resolved through `${...}` references in `zhin.config.yml`; the adapter
protocol does not read them directly.

| Variable | Description |
|----------|-------------|
| `WECOM_CORP_ID` | Enterprise ID |
| `WECOM_AGENT_SECRET` | Application Secret |
| `WECOM_TOKEN` | Callback signature Token |
| `WECOM_AES_KEY` | EncodingAESKey (43 characters) |

## Message Type Support

| Inbound Type | Content Summary |
|--------------|-----------------|
| text | Original text |
| image | `[image: url]` |
| voice | Recognition result or `[voice]` |
| video / shortvideo | `[video]` |
| location | `[location] ...` |
| link | `[link: ...]` |
| event | `[event] ...` |

| Outbound Wire | Description |
|---------------|-------------|
| text | Supports `<@userid>` |
| image | Requires `media_id` |
| markdown | WeCom native Markdown |
| news | Link segment mapping |

## Security Notes

WeCom callbacks are always encrypted:

- **Signature**: SHA1 sorted concatenation of `[token, timestamp, nonce, encrypt]`
- **Decryption**: AES-256-CBC (Key = Base64 of `encodingAESKey` + `=`, IV = first 16 bytes of Key)

Access Token is automatically refreshed 5 minutes before expiration.

## Console page

Open the Console **WeCom** page (route `/wecom`) to:

- view running connections and test connectivity;
- add, edit, start, stop, replace, or remove accounts through Host runtime storage; startup configuration and `.env` remain unchanged;
- complete LoginAssist tasks (QR code, slider or device confirmation) when the adapter asks for a login;

An administrator must review and confirm the existing account list before its first migration; identity and history are retained. New or replaced accounts are saved disabled and must be started explicitly. A connection update reconnects only that account; replacement uses a new internal identity and does not inherit Sessions or settings. If a commit outcome is unknown, refresh to verify it before taking another action.

Reading requires `wecom:read`; writes require `wecom:write`. A full admin token is unrestricted. "Add endpoint" is equivalent to the old `wecom endpoint add` command.

## Troubleshooting

| Symptom | Investigation |
|---------|---------------|
| URL verification failure | `token` / `encodingAESKey` / `corpId` must match the admin console; Host must be listening and publicly accessible |
| Not receiving messages | Application must have message reception enabled; sender must be in the visible range; endpoint must have called `open()` |
| Send failure | `corpId` + `agentSecret` must be able to obtain a token; recipient must be in the visible range |

## AI Tools

| Category | Path |
|----------|------|
| Permit vocabulary | `PERMITS.md` |
| Platform tools (4) | `tools/` |
| Skill documentation | `agents/wecom/skills/wecom/SKILL.md` |

## Platform Permissions (platform permit)

`plugin.ts` registers the `src/platform-permit.ts` checker during generation setup and unregisters on dispose; CapabilityIngress and ToolSystem uniformly consume tool permissions via Core's `canAccessTool()`.

## Related Links

- [WeCom Developer Documentation](https://developer.work.weixin.qq.com/document/)
- [Receive Messages](https://developer.work.weixin.qq.com/document/path/90930)
- [Send Application Messages](https://developer.work.weixin.qq.com/document/path/90236)

## License

MIT License
