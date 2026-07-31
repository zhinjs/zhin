---
title: "@zhin.js/adapter-weixin-ilink"
package: "@zhin.js/adapter-weixin-ilink"
tier: Experimental
---

::: info Documentation Sync
This page is auto-generated from [`plugins/adapters/weixin-ilink/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/weixin-ilink/README.md). Please edit the in-package README and then run `pnpm sync:adapter-docs`.
:::

<!-- sync-adapter-docs:sha256=36c986830b317252 -->

# @zhin.js/adapter-weixin-ilink

Connects to **personal WeChat** via the WeChat **iLink Endpoint API** (ClawBot grayscale entry), supporting text and full media send/receive. Plugin Runtime convention-based `defineAdapter` (long polling inbound, no host-router / Koa).

The protocol implementation is ported from [Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin) (MIT). OpenClaw coupling has been removed, and `bot_agent` defaults to `Zhin.js/<version>`.

## Differences from wechat-mp

| Item | weixin-ilink | wechat-mp |
|------|-------------|-----------|
| Account type | Personal WeChat (ClawBot) | WeChat Official Account |
| Inbound | Long polling `getupdates` -> `messageGatewayToken` | Webhook (`httpHostToken`) |
| Login | QR code / sidecar credentials / `botToken` | AppId/Secret/Token |
| Group chat | Not supported (private chat only) | Supported |

Can be **enabled simultaneously** with `@zhin.js/adapter-wechat-mp`.

## Prerequisites

- The WeChat client must have grayscale access to **ClawBot** (latest WeChat version + grayscale eligibility)
- Node.js ^20.19.0 or >=22.12.0

## Minimal Configuration

```yaml
plugins:
  weixin-ilink:
    # botAgent: "Zhin.js/1.0.0"
    # longPollTimeoutMs: 35000
    # baseUrl: https://ilinkai.weixin.qq.com
    endpoints:
      - name: my-wechat
        # botToken: "..."                 # or environment variable WEIXIN_ILINK_TOKEN
```

`botToken` can also be saved in a sidecar file (not committed to git):

```
data/weixin-ilink/<bot-name>.json
```

## Login Flow

1. On first start without credentials, calls `get_bot_qrcode` and prints QR code content in logs
2. User scans the QR code with WeChat to confirm
3. Background polls `get_qrcode_status` until `confirmed`, writes to `data/weixin-ilink/<name>.json`
4. Calls `notifyStart` and enters long polling

> The Console QR code panel (old `loginAssist` + host-router) has been removed from the production path; prefer `botToken` / sidecar credentials.

## Outbound Notes

Replies must carry the `context_token` cached at inbound time (keyed by `endpointId + peerUserId`). If the user has not sent a message for a long time, causing the token to be missing, outbound will be rejected with a warning.

Outbound goes through the Runtime: `MessageGateway` -> `endpoint.send({ target, payload })`.

**Image-text limitation**: WeChat does not support mixed image-text in a single message. The adapter automatically:

- **Outbound**: Sends text first, then sends pure media (without caption) separately
- **Inbound**: Writes both text and media paths into a single gateway `content` text

## Troubleshooting

| Symptom | Possible Cause |
|---------|----------------|
| Cannot scan QR code / no ClawBot entry | Not in grayscale; requires latest WeChat + grayscale eligibility |
| QR code expired | Restart the adapter to get a new one |
| Cannot send messages | Missing `context_token`; have the user send a message first |
| `errcode -14` | Session expired; the adapter automatically pauses for 1 hour before retrying |

## Documentation

- Adapter index: [`plugins/adapters/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/weixin-ilink/README.md)
- In-place migration: [`docs/architecture/target-implementation/in-place-migration.md`](https://github.com/zhinjs/zhin/tree/main/plugins/docs/architecture/target-implementation/in-place-migration.md)
