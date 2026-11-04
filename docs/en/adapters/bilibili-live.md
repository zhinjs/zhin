---
title: "@zhin.js/adapter-bilibili-live"
package: "@zhin.js/adapter-bilibili-live"
tier: Experimental
---

::: info Documentation Sync
This page translates [`plugins/adapters/bilibili-live/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/bilibili-live/README.md). Keep this English page aligned with the README; `pnpm sync:adapter-docs` updates the Chinese pages.
:::

# @zhin.js/adapter-bilibili-live

> **Experimental** — built on Bilibili Live's **unofficial web APIs** (danmaku WebSocket, `msg/send`). It may break whenever the platform changes. It is not part of the stable smoke tests, and its interface and config may change incompatibly.

A Bilibili live danmaku adapter for Zhin.js (Plugin Runtime). The Bot watches danmaku in **your own live room** and picks one to answer, like a streamer would. Design: [ADR 0038: Continuous input merge](https://github.com/zhinjs/zhin/blob/main/docs/adr/0038-continuous-input-merge.md) §5. Discussion: [#1049](https://github.com/zhinjs/zhin/issues/1049).

## Read this first

- **One reply per window**: the adapter declares the `liveDanmaku` capability. The Agent does not answer each danmaku. It collects danmaku in a window, and the model picks one (or summarizes them) and replies once. Two replies are at least `ai.agent.inboundQueue.live.minIntervalMs` apart (15 seconds by default).
- **Danmaku turns are read-only**: they run with anonymous-viewer access and only see tools that declare `readOnly: true`. They never show an approval card and never run shell, MCP or sub-agents. Muting and blocking do not go through danmaku.
- **Danmaku is posted as your account**: sending needs your login cookies (`SESSDATA` + `bili_jct`). Treat them like your password: **inject them with environment variables, never write them in plain text in `zhin.config.yml`, never commit them, and never paste them into logs or issues**. Without cookies the Bot can only listen anonymously (the platform masks nicknames and reports uid 0) and cannot send.
- **Direct send by default**: `sendMode` defaults to `direct`, so replies go out as danmaku immediately (danmaku is real-time; review-then-send makes no sense). Set `sendMode: off` to let the Bot listen without speaking.
- **Your own room only**: the endpoint connects only to the `roomId` you configure and only posts there. Follow Bilibili's user agreement; marketing, traffic farming and spam are forbidden.
- **Risk control trips a breaker**: on rate-limit (`10031`) or risk-control error codes, the endpoint stops sending and logs the error. It does not retry automatically; check the account and restart.

## Prerequisites

1. The id of your own Bilibili live room (`roomId`; short or full id)
2. To let the Bot send danmaku: your `SESSDATA` and `bili_jct` cookies in `.env` (gitignored) as `BILIBILI_SESSDATA` and `BILIBILI_BILI_JCT`. Leave them out to listen only
3. The Agent is enabled (`ai.agent`): its `inboundQueue.live` drives the danmaku window

## Minimal Configuration

```yaml
configVersion: 2
plugins:
  bilibili-live: "@zhin.js/adapter-bilibili-live"
bilibili-live:
  sendMode: direct          # default; off = listen only
  maxLength: 20             # characters per danmaku; higher live levels allow more
  maxChunks: 2              # danmaku per reply at most
  minSendIntervalSec: 5     # minimum gap between two sends (the Agent adds its own 15 s window gap)
  endpoints:
    - id: my-live
      roomId: 123456        # your own live room only
      sessdata: ${BILIBILI_SESSDATA}
      biliJct: ${BILIBILI_BILI_JCT}
```

Required fields (`endpoints[i]`): `id`, `roomId`.

## Danmaku window

The window is configured on the Agent, not on this adapter:

```yaml
ai:
  agent:
    inboundQueue:
      live:
        mode: pick-one        # pick-one: answer one; summary: summarize the window and answer once
        windowMs: 10000       # how long after the first danmaku the window closes
        minIntervalMs: 15000  # minimum gap between two danmaku replies
```

Danmaku from a `master` skips the window and gets its own turn. The audit code `danmaku_window_picked` records the candidate count and the picked item.

## Conversations and messages

| Field | Value |
|---|---|
| `conversation` | `{ kind: 'channel', id: <full room id> }` |
| `message.id` | Platform danmaku id (timestamp + uid + sequence when missing) |
| `sender.id` | Viewer uid; `anon:<masked nickname>` when listening anonymously |
| `metadata` | `{ roomId, liveDanmaku: true }` |

Outbound is plain text only: Markdown is stripped and images and other segments are unsupported. The first `mention` in a reply is not written into the text; it becomes the platform's "reply to" field, so the picked viewer sees it.

## Disk usage

The adapter writes nothing to disk. The dedupe table (the latest 500 danmaku ids) and connection state live in memory and are cleared on restart.

## Known limitations

- Without login the platform reports uid 0 and masked nicknames, so anonymous viewers with the same masked nickname count as one person.
- The platform may change its APIs at any time (for example WBI signing or risk control on `getDanmuInfo`). The connection then keeps failing and backing off; watch the logs.

## Console page

Open the Console **Bilibili Live** page (route `/bilibili-live`) to:

- view running connections and test connectivity;
- add, edit, start, stop, replace, or remove accounts through Host runtime storage; startup configuration and `.env` remain unchanged;
- complete LoginAssist tasks (QR code, slider or device confirmation) when the adapter asks for a login;

An administrator must review and confirm the existing account list before its first migration; identity and history are retained. New or replaced accounts are saved disabled and must be started explicitly. A connection update reconnects only that account; replacement uses a new internal identity and does not inherit Sessions or settings. If a commit outcome is unknown, refresh to verify it before taking another action.

Reading requires `bilibili-live:read`; writes require `bilibili-live:write`. A full admin token is unrestricted. "Add endpoint" is equivalent to the old `bilibili-live endpoint add` command.

QR login still lives on the Bilibili comment adapter page; this page manages live-danmaku connections and endpoints.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Log `bilibili_live_anonymous` | No cookies or expired cookies: listening anonymously, and sends fail with `not_logged_in`. Refresh the cookies and restart |
| Connection keeps failing, `getDanmuInfo` returns `-352` | Risk control blocked the token request. Check the cookies, add `buvid3` and restart; if it still fails the API has changed |
| `bilibili live auth rejected` | The auth packet was rejected (expired token or wrong room). Check `roomId`; reconnects fetch a fresh token |
| Log `bilibili_live_circuit_open` | Sending hit rate limiting or risk control and has stopped. Raise `minSendIntervalSec` or `inboundQueue.live.minIntervalMs`, check the account and restart |
| Reply cut off with "…" | It exceeded `maxLength × maxChunks`. Accounts with a higher live level can raise `maxLength` |
| Send returns `rate_limited` | Less than `minSendIntervalSec` since the last send; this reply is dropped, not queued |
