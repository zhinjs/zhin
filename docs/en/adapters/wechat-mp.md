---
title: "@zhin.js/adapter-wechat-mp"
package: "@zhin.js/adapter-wechat-mp"
tier: Advanced
---

::: info Documentation Sync
This page is auto-generated from [`plugins/adapters/wechat-mp/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/wechat-mp/README.md). Please edit the in-package README and then run `pnpm sync:adapter-docs`.
:::

<!-- sync-adapter-docs:sha256=41c1f0a84a180dcd -->

# @zhin.js/adapter-wechat-mp

Zhin.js WeChat Official Account adapter (Plugin Runtime). Sends and receives messages via the Runtime Host HTTP Webhook.

## Features

- Webhook event reception (`httpHostToken` GET signature verification + POST messages)
- Signature verification with optional AES encryption/decryption
- Automatic Access Token refresh
- XML message parsing
- Convention-based `defineAdapter` / `definePlugin` (no `usePlugin` needed)

## Installation

```bash
pnpm add @zhin.js/adapter-wechat-mp
```

## Plugin Runtime

- `@zhin.js/adapter` — convention-based `adapters/wechat-mp.ts` (`defineAdapter`)
- `@zhin.js/core` — `Endpoint.emit(...)` inbound, `outboundMessageToken` outbound
- `@zhin.js/host-http` — `httpHostToken` registers Webhook route (**not** legacy host-router/Koa)
- `zhin.js` — `plugin.ts` (`definePlugin`)
- Configuration goes to `plugins.<instanceKey>` via the plugin's `schema.json`

Inbound: `gateway.receive({ conversation, message, content, sender, metadata })` (always `kind: 'private'`, `conversation.id` is the openid)
Outbound: `send({ conversation, payload })` -> passive reply XML (default) or Customer Service Message API (`replyMode: customer_service`; touser is `conversation.id`)

## Prerequisites

| Requirement | Description |
|-------------|-------------|
| **Official Account** | A registered WeChat Official Account; obtain `AppID` and `AppSecret` from the [WeChat Official Account Platform](https://mp.weixin.qq.com/) |
| **Server configuration** | Configure Token (must match the `token` field); server URL must be publicly accessible |
| **host-http** | **Required** — Runtime Host provides HTTP; the adapter registers GET/POST on `path` |
| **Response time limit** | WeChat requires a response within **5 seconds**; timeouts will cause connection failure |
| **Reply mode** | Default `replyMode: passive` (subscription account passive reply); service accounts can set `customer_service` |
| **Message encryption** | Optional; `encrypt: true` + `encodingAESKey`; `encryptMode: compatible` (default) or `secure` |

Required fields (`endpoints[i]`): `name`, `appId`, `appSecret`, `token`.

## Minimal Configuration

```yaml
# zhin.config.yml (Plugin Runtime)
plugins:
  wechat-mp:
    path: /wechat/webhook
    endpoints:
      - name: my-wechat-bot
        appId: "${WECHAT_APP_ID}"
        appSecret: "${WECHAT_APP_SECRET}"
        token: "${WECHAT_TOKEN}"
```

The root plugin `zhin.plugins` (or project graph) must reference `@zhin.js/adapter-wechat-mp` (`instanceKey: wechat-mp`).
The Runtime Host (`http`) must already be listening for the Webhook to be reachable.

### Optional Fields

- `path`: Webhook path, default `/wechat/webhook`
- `replyMode`: `passive` (default) | `customer_service`
- `passiveReplyTimeoutMs`: Passive reply wait limit, default `4500`
- `encrypt` / `encodingAESKey` / `encryptMode`

## WeChat Official Account Configuration

1. Log in to the [WeChat Official Account Platform](https://mp.weixin.qq.com/)
2. Obtain `AppID` and `AppSecret` from "Development -> Basic Configuration"
3. Configure the server address (URL): `https://your-server/wechat/webhook` (no `/api` prefix; map through reverse proxy as needed)
4. Set the Token (must match the `token` in the configuration file)
5. If message encryption is needed, set the EncodingAESKey

## Troubleshooting

| Symptom | Investigation |
|---------|---------------|
| Server configuration verification failure | `token` must match the Official Account Platform; URL should be `https://<host>/wechat/webhook`; Runtime Host must be listening and publicly accessible |
| Not receiving user messages | Check if the Official Account type supports the message interface; check if the user has followed the account; `path` must match the Official Account Platform URL; endpoint must have called `open()` |
| Reply timeout / no reply | Default passive reply must complete within **~4.5s**; consider switching to `replyMode: customer_service` (requires Customer Service API permissions) |
| `48001 api unauthorized` | Unverified subscription accounts do not have Customer Service API access; keep the default `replyMode: passive` |
| Encryption mode error | `encodingAESKey`, `encrypt` must match the Official Account Platform's "Security Mode" settings |

## AI Tools

See `agent/skills/wechat-mp.md` for skill documentation.

## Documentation Links

- [WeChat Official Account adapter docs](https://zhin.js.org/adapters/wechat-mp)
- [Adapters overview](https://zhin.js.org/essentials/adapters)
- [WeChat Official Account Platform](https://mp.weixin.qq.com/)

## License

MIT License
