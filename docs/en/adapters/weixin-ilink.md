---
title: "@zhin.js/adapter-weixin-ilink"
package: "@zhin.js/adapter-weixin-ilink"
tier: Experimental
---

::: info Documentation Sync
This page translates [`plugins/adapters/weixin-ilink/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/weixin-ilink/README.md). Keep this English page aligned with the README; `pnpm sync:adapter-docs` updates the Chinese pages.
:::

<!-- sync-adapter-docs:sha256=36c986830b317252 -->

# @zhin.js/adapter-weixin-ilink

Connects to **personal WeChat** via the WeChat **iLink Endpoint API** (ClawBot grayscale entry), supporting text and full media send/receive. Plugin Runtime convention-based `defineAdapter` (long polling inbound, no host-router / Koa).

The protocol implementation is ported from [Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin) (MIT). OpenClaw coupling has been removed, and `bot_agent` defaults to `Zhin.js/<version>`.

## Differences from wechat-mp

| Item | weixin-ilink | wechat-mp |
|------|-------------|-----------|
| Account type | Personal WeChat (ClawBot) | WeChat Official Account |
| Inbound | Long polling `getupdates` -> `endpoint[endpointSpec].events.emit(...)` | Webhook (`httpHostToken`) |
| Login | QR code / sidecar credentials / `botToken` | AppId/Secret/Token |
| Group chat | Not supported (private chat only) | Supported |

Can be **enabled simultaneously** with `@zhin.js/adapter-wechat-mp`.

## Prerequisites

- The WeChat client must have grayscale access to **ClawBot** (latest WeChat version + grayscale eligibility)
- Node.js >=22.19.0

## Minimal Configuration

```yaml
configVersion: 2
plugins:
  weixin-ilink: "@zhin.js/adapter-weixin-ilink"
weixin-ilink:
  # botAgent: "Zhin.js/1.0.0"
  # longPollTimeoutMs: 35000
  # baseUrl: https://ilinkai.weixin.qq.com
  # dataDir: data/weixin-ilink
  endpoints:
    - id: my-wechat
      # botToken: "..."                 # Optional; otherwise load state or scan QR
```

`AdapterIndex` merges instance defaults with each endpoint override before invoking the adapter. The protocol accepts only that expanded endpoint configuration; it does not read environment variables or inspect nested `endpoints`.

Each Endpoint owns one `WeixinIlinkStateStore` for credentials, the long-poll cursor, context tokens, and media. `botToken` can also be saved under `dataDir` (not committed to git):

```
data/weixin-ilink/<id>/credentials.json
```

## Login Flow

1. On first start without credentials, calls `get_bot_qrcode` and prints QR code content in logs
2. User scans the QR code with WeChat to confirm
3. Background polls `get_qrcode_status` until `confirmed`, then writes `dataDir/<id>/credentials.json`
4. Calls `notifyStart` and enters long polling

## Outbound Notes

Replies must carry the `context_token` cached at inbound time (keyed by `endpointId + peerUserId`). If the user has not sent a message for a long time, causing the token to be missing, outbound will be rejected with a warning.

Outbound goes through the Runtime: `OutboundMessageService` -> the send hook registered through `createEndpointSpecification` (always `kind: 'private'`, `conversation.id` is the peer user_id).

**Image-text limitation**: WeChat does not support mixed image-text in a single message. The adapter automatically:

- **Outbound**: Sends text first, then sends pure media (without caption) separately
- **Inbound**: Writes both text and media paths into a single gateway `content` text

## Console page

Open the Console **Weixin iLink** page (route `/weixin-ilink`) to:

- view running connections and test connectivity;
- add, edit, start, stop, replace, or remove accounts through Host runtime storage; startup configuration and `.env` remain unchanged;
- complete LoginAssist tasks (QR code, slider or device confirmation) when the adapter asks for a login;

An administrator must review and confirm the existing account list before its first migration; identity and history are retained. New or replaced accounts are saved disabled and must be started explicitly. A connection update reconnects only that account; replacement uses a new internal identity and does not inherit Sessions or settings. If a commit outcome is unknown, refresh to verify it before taking another action.

Reading requires `weixin-ilink:read`; writes require `weixin-ilink:write`. A full admin token is unrestricted. "Add endpoint" is equivalent to the old `weixin-ilink endpoint add` command.

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
