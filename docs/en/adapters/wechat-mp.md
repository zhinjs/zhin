---
title: "@zhin.js/adapter-wechat-mp"
package: "@zhin.js/adapter-wechat-mp"
tier: Advanced
---

::: info Documentation Sync
This page translates [`plugins/adapters/wechat-mp/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/wechat-mp/README.md). Keep this English page aligned with the README; `pnpm sync:adapter-docs` updates the Chinese pages.
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

The owning `Adapter` manages desired accounts and running incarnations. The actual SDK or protocol Client implements structural `Endpoint`; framework hooks use `endpointSpec` without replacing native SDK APIs. Complete accepted callbacks enter through `events.run(...)` before deduplication and asynchronous normalization; see [Adapter authoring](/en/authoring/adapters).

- `@zhin.js/adapter` — convention-based `adapters/wechat-mp/index.ts` (`defineAdapter`)
- `@zhin.js/core` — `endpoint[endpointSpec].events.emit(...)` inbound, `outboundMessageToken` outbound
- `@zhin.js/host-http` — `httpHostToken` registers Webhook route (**not** legacy host-router/Koa)
- `zhin.js` — `plugin.ts` (`definePlugin`)
- Configuration goes to the top-level `<instanceKey>` block via the plugin's `schema.json`

Inbound: `endpoint[endpointSpec].events.emit('message.receive', { conversation, message, content, sender, metadata })` (always `kind: 'private'`, `conversation.id` is the openid)
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

Required fields (`endpoints[i]`): `id`, `appId`, `appSecret`, `token`. AdapterIndex
merges instance defaults into every endpoint; the protocol receives only one expanded endpoint config.

## Minimal Configuration

```yaml
configVersion: 2
# zhin.config.yml (Plugin Runtime)
plugins:
  wechat-mp: "@zhin.js/adapter-wechat-mp"
wechat-mp:
  path: /wechat/webhook
  endpoints:
    - id: my-wechat-bot
      appId: "${WECHAT_APP_ID}"
      appSecret: "${WECHAT_APP_SECRET}"
      token: "${WECHAT_TOKEN}"
```

The root plugin the main configuration `plugins` map (or project graph) must reference `@zhin.js/adapter-wechat-mp` (`instanceKey: wechat-mp`).
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

## Console page

Open the Console **WeChat MP** page (route `/wechat-mp`) to:

- view running connections and test connectivity;
- add, edit, start, stop, replace, or remove accounts through Host runtime storage; startup configuration and `.env` remain unchanged;
- complete LoginAssist tasks (QR code, slider or device confirmation) when the adapter asks for a login;

An administrator must review and confirm the existing account list before its first migration; identity and history are retained. New or replaced accounts are saved disabled and must be started explicitly. A connection update reconnects only that account; replacement uses a new internal identity and does not inherit Sessions or settings. If a commit outcome is unknown, refresh to verify it before taking another action.

Reading requires `wechat-mp:read`; writes require `wechat-mp:write`. A full admin token is unrestricted. "Add endpoint" is equivalent to the old `wechat-mp endpoint add` command.

## Troubleshooting

| Symptom | Investigation |
|---------|---------------|
| Server configuration verification failure | `token` must match the Official Account Platform; URL should be `https://<host>/wechat/webhook`; Runtime Host must be listening and publicly accessible |
| Not receiving user messages | Check if the Official Account type supports the message interface; check if the user has followed the account; `path` must match the Official Account Platform URL; endpoint must have called `open()` |
| Reply timeout / no reply | Default passive reply must complete within **~4.5s**; consider switching to `replyMode: customer_service` (requires Customer Service API permissions) |
| `48001 api unauthorized` | Unverified subscription accounts do not have Customer Service API access; keep the default `replyMode: passive` |
| Encryption mode error | `encodingAESKey`, `encrypt` must match the Official Account Platform's "Security Mode" settings |

## AI Tools

See `skills/wechat-mp/SKILL.md` for skill documentation.

## Documentation Links

- [WeChat Official Account adapter docs](https://zhin.js.org/adapters/wechat-mp)
- [Adapters overview](https://zhin.js.org/essentials/adapters)
- [WeChat Official Account Platform](https://mp.weixin.qq.com/)

## License

MIT License
