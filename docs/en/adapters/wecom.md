---
title: "@zhin.js/adapter-wecom"
package: "@zhin.js/adapter-wecom"
tier: Experimental
---

::: info Documentation Sync
This page is auto-generated from [`plugins/adapters/wecom/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/wecom/README.md). Please edit the in-package README and then run `pnpm sync:adapter-docs`.
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

- `@zhin.js/adapter` — convention-based `adapters/wecom.ts` (`defineAdapter`)
- `@zhin.js/core` — `messageGatewayToken` inbound/outbound
- `@zhin.js/host-http` — `httpHostToken` registers Webhook route (**not** legacy host-router/Koa)
- `@zhin.js/plugin-runtime` — `plugin.ts` (`definePlugin`)
- Configuration goes to `plugins.<instanceKey>` via the plugin's `schema.json`

Inbound: `gateway.receive({ adapter, target: FromUserName, content: text, sender, metadata })`
Outbound: `send({ target, payload })` -> WeCom `message/send` API

Inbound `metadata.mentioned`: **not wired**. The XML event in WeCom application message callbacks does not contain mentions/@ fields. The `ToUserName` in the callback is the CorpID (Enterprise ID) rather than a comparable bot user id, and the configuration does not contain a bot id/name that can serve as a reliable basis for comparison, so @ bot detection is not reliably possible.

## Prerequisites

### WeCom Admin Console Configuration

1. Log in to the [WeCom Admin Console](https://work.weixin.qq.com/wework_admin/frame)
2. "App Management" -> "Self-built" -> Create an application, obtain **CorpId**, **AgentId**, **Secret**
3. "Receive Messages" settings:
   - **URL**: `https://yourdomain.com/wecom/callback`
   - **Token** / **EncodingAESKey** must match the configuration
4. The Runtime Host (`http`) must already be listening for the Webhook to be reachable

Required fields (`endpoints[i]`): `name`, `corpId`, `agentSecret`, `token`, `encodingAESKey`.

## Minimal Configuration

```yaml
# zhin.config.yml (Plugin Runtime)
plugins:
  wecom:
    webhookPath: /wecom/callback       # optional, default /wecom/callback
    apiBaseUrl: https://qyapi.weixin.qq.com  # optional
    endpoints:
      - name: wecom-bot
        corpId: ${WECOM_CORP_ID}
        agentSecret: ${WECOM_AGENT_SECRET}
        token: ${WECOM_TOKEN}
        encodingAESKey: ${WECOM_AES_KEY}
```

The root plugin `zhin.plugins` (or project graph) must reference `@zhin.js/adapter-wecom` (`instanceKey: wecom`).

## Environment Variables

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

## Troubleshooting

| Symptom | Investigation |
|---------|---------------|
| URL verification failure | `token` / `encodingAESKey` / `corpId` must match the admin console; Host must be listening and publicly accessible |
| Not receiving messages | Application must have message reception enabled; sender must be in the visible range; endpoint must have called `open()` |
| Send failure | `corpId` + `agentSecret` must be able to obtain a token; recipient must be in the visible range |

## AI Tools

| Category | Path |
|----------|------|
| Permit vocabulary | `agent/PERMITS.md` |
| Platform tools (4) | `agent/tools/` |
| Skill documentation | `agent/skills/wecom.md` |

## Platform Permissions (platform permit)

`plugin.ts` registers the `src/platform-permit.ts` checker during generation setup and unregisters on dispose; CapabilityIngress and ToolSystem uniformly consume tool permissions via Core's `canAccessTool()`.

## Related Links

- [WeCom Developer Documentation](https://developer.work.weixin.qq.com/document/)
- [Receive Messages](https://developer.work.weixin.qq.com/document/path/90930)
- [Send Application Messages](https://developer.work.weixin.qq.com/document/path/90236)

## License

MIT License
