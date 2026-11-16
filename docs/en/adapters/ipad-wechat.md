---
title: "@zhin.js/adapter-ipad-wechat"
package: "@zhin.js/adapter-ipad-wechat"
tier: Experimental
---

::: info Documentation Sync
This page translates [`plugins/adapters/ipad-wechat/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/ipad-wechat/README.md). Keep this English page aligned with the README; `pnpm sync:adapter-docs` updates the Chinese pages.
:::

<!-- sync-adapter-docs:sha256=bbe94a9e8059b475 -->

# @zhin.js/adapter-ipad-wechat

Connects **personal WeChat** through the `@wchats/ipad` SDK (iPad protocol, local signing module `@wchats/ipad-sign`): text, images and group mentions in private and group chats. A Plugin Runtime convention `defineAdapter`; the SDK runs in-process, no separate protocol service is needed.

## Compared with the other WeChat adapters

| | ipad-wechat | weixin-ilink | wechat-mp |
|---|---|---|---|
| Account type | Personal WeChat | Personal WeChat (ClawBot) | Official Account |
| Group chats | Yes | No | Yes |
| Login | QR code / restore a saved session | QR code / `botToken` | AppId/Secret |
| Dependencies | `@wchats/ipad` + `@wchats/ipad-sign` | none | none |

## Prerequisites

- Node.js 24 (the SDK requires `>=24 <25`)
- Platforms: macOS arm64 / x64, Linux x64 / arm64 (glibc only). The signing module ships native files for these four platforms
- `@wchats/ipad` and `@wchats/ipad-sign` are **distributed privately** by wchats on GitHub Packages; you need access (a token with `read:packages` on the `wchats` organization's packages)

## Installation

Point the bot project's `.npmrc` at GitHub Packages and keep the token in the environment:

```ini
@wchats:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NPM_TOKEN}
```

```bash
pnpm add @zhin.js/adapter-ipad-wechat @wchats/ipad@0.0.1 @wchats/ipad-sign@0.0.1
```

Both SDK packages are optional peers: without them the plugin still loads, and starting an account fails with a hint to install them. Their versions must match each other.

## Minimal Configuration

```yaml
configVersion: 2
plugins:
  ipad-wechat: "@zhin.js/adapter-ipad-wechat"
ipad-wechat:
  # dataDir: data/ipad-wechat
  endpoints:
    - id: my-wechat
```

| Field | Default | Description |
| --- | --- | --- |
| `dataDir` | `data/ipad-wechat` | SDK state root; each account uses `<dataDir>/accounts/<instance>`. **One directory belongs to one process at a time**; it holds the session and signing state, treat it as a secret |
| `loginTimeoutMs` | `600000` | QR / restore login timeout |
| `qrPollIntervalMs` | `1000` | QR status polling interval (100–30000) |
| `heartbeatIntervalSeconds` | SDK default | Business heartbeat interval |
| `reconnect` | `true` | Let the SDK reconnect the long link |
| `ignoreSelfMessages` | `true` | Skip messages this account sent from another device |
| `downloadImages` | `true` | Download inbound images to `<account dir>/media/inbound` first (kept 24 hours) |
| `verification` | — | Device verification page (below) |

## Login

Starting the account calls the SDK's `run()`: it restores a saved session, otherwise it logs in by QR code.

- The QR code appears in the Console login panel and is written to `<account dir>/login-qrcode.png` (mode 0600).
- The account is online once the SDK confirms the first business heartbeat (`online.ready`).
- Stopping an account only stops and closes locally; it **never logs out of WeChat**.

### Device verification (slider / face)

When WeChat asks to verify a new device, the SDK login ends with `verification_required`. Without `verification` the account fails to start with a hint; with it, the adapter opens the SDK's HTTPS verification page through `createVerificationServer()`:

```yaml
ipad-wechat:
  endpoints:
    - id: my-wechat
      verification:
        key: ./verification/key.pem
        cert: ./verification/cert.pem
        host: 0.0.0.0                       # reachable from a phone
        port: 8443
        publicOrigin: https://192.168.1.10:8443
```

The verification link is a credential of this challenge: it is shown only in the Console login panel and written to `<account dir>/verification-url.txt` (0600, removed afterwards), never to the log. The certificate SAN must match `publicOrigin` and the phone must trust its issuer. If you need the official face-page hand-off (verification proxy), first log in once with the SDK's login example in the same account directory, then start the adapter to restore.

## Capabilities

| Capability | Support |
| --- | --- |
| Receive: private and group text | ✓ (the group sender is the member's wxid) |
| Receive: images | ✓ downloaded and delivered as a local image segment; falls back to `[图片]` on failure |
| Receive: voice, video, stickers, links … | Text placeholders (`[语音]` …); the raw SDK message is in `event` |
| Send: text, group mentions | ✓ (`mention` segments become `@name` + the SDK `at` list) |
| Send: images | ✓ (https URLs go to the SDK; base64 / local paths are read as bytes) |
| Send: voice, video, files, quote replies, recall | ✗ (`reply` segments are ignored) |
| Friend / group / member lists | ✓ (full directory scan cached for 10 minutes) |

Delivery follows the SDK:

- **Inbound**: the SDK acknowledges a message when its listener returns. The adapter returns only after Zhin admitted the message; while input is closed it waits instead of failing; when the account stops it does not acknowledge, and the SDK redelivers on the next run.
- **Outbound**: every send uses a fresh `operationId` and is reclaimed after a terminal result (sent or rejected); **an unknown result is reported as `unknown` and never resent under a new ID**.

Other SDK deliveries (`sync.command`, `sync.error`, `init.page`, `longlink.*`, `session.blocked`) are forwarded as platform events; a long-link `error` event ends the current run (as in the SDK's online example). For SDK-only features (Moments, group announcements, invitations …) use the Endpoint's `sdkClient`.

## Console page

The plugin page `/ipad-wechat` shows account status, tests the connection and adds or removes endpoints; reading needs `ipad-wechat:read`, writing needs `ipad-wechat:write`. QR login and device verification happen in the Console login panel.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Start fails with `cannot load @wchats/ipad` | `@wchats/ipad` / `@wchats/ipad-sign` not installed, or `.npmrc` does not point at GitHub Packages, or the token lacks `read:packages` |
| `SIGN_NATIVE_UNAVAILABLE` | No native signing file for this platform (only macOS arm64/x64 and Linux x64/arm64 glibc; musl such as Alpine is unsupported) |
| `STATE_IN_USE` | Another process holds the same `dataDir`; one running instance per account directory |
| Start fails mentioning `verification` | WeChat asks for device verification; configure `verification` as above, or log in once with the SDK login example in the same directory |
| QR code expired | Restart the account in Console to get a new QR code |
| A send reports `unknown` | The outcome is unknown (e.g. the link dropped while writing); the SDK does not resend, check whether it arrived before retrying by hand |
| A group mention is not highlighted | An outbound `mention` without `name` uses the wxid instead of the nickname |

## Development

Tests use the in-memory fake client in `tests/fake-sdk.ts`; they need no SDK, load no native module and use no network:

```bash
pnpm vitest run plugins/adapters/ipad-wechat
```
