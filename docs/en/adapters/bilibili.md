---
title: "@zhin.js/adapter-bilibili"
package: "@zhin.js/adapter-bilibili"
tier: Experimental
---

::: info Documentation Sync
This page is auto-generated from [`plugins/adapters/bilibili/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/bilibili/README.md). Please edit the in-package README and then run `pnpm sync:adapter-docs`.
:::

<!-- sync-adapter-docs:sha256=8e234a00fd9ec03a -->

# @zhin.js/adapter-bilibili

> **Experimental** — built on Bilibili's **unofficial Web APIs** and may break at any time when the site changes. Not part of the stable smoke suite; config and behavior may change incompatibly.

Zhin.js Bilibili comment adapter (Plugin Runtime): lets AI help you reply to comments under **your own videos**. Contract: [ADR 0035: Comment-reply adapter contract](/adr/0035-comment-reply-adapter-contract). Discussion: [#971](https://github.com/zhinjs/zhin/issues/971).

## Read this first

- **It acts as your account**: Bilibili's open platform grants no comment read/write scopes, so this adapter uses your login cookies (`SESSDATA` + `bili_jct`). Treat them like a password: inject them via environment variables / a secret store only. **Never put them in `zhin.config.yml` in plain text, commit them, or paste them into logs or issues.**
- **Review before send by default**: `sendMode` defaults to `review`. AI-written replies only land in a draft queue and are **never posted to Bilibili automatically**. v1 offers no auto-send.
- **Allow-listed videos only**: only the videos listed in `videos` are polled (ideally your own uploads). No site-wide search, no posting in other people's comment sections. Follow Bilibili's user agreement — no marketing, lead generation, or spam.
- **Risk control trips a breaker**: on rate-limit / captcha / risk-block / duplicate-comment codes the endpoint stops polling and logs an error with no automatic retry; restart after checking the account manually.

## Current capabilities (v1 scaffold)

| Capability | Status |
|---|---|
| BV id → aid | ✅ |
| Poll latest comments on allow-listed videos (`x/v2/reply`, video `type=1` only) | ✅ read-only |
| Detect own uid from cookie login, skip own comments | ✅ |
| One comment thread = one conversation (`video:<aid>:<rootRpid>`) | ✅ |
| First poll only records a baseline (history is not fed to AI) | ✅ |
| AI replies go to a draft queue (`review`) | ✅ in-memory, lost on restart |
| Actually posting after approval (`x/v2/reply/add`) | 🚧 client method exists, **not wired** |
| "Replies to me / @me" notifications (`x/msgfeed/*`) | 🚧 not yet |
| QR login / cookie persistence | 🚧 not yet |
| Dynamic / article comments | 🚧 v1.1 |

## Prerequisites

1. Your own Bilibili account and the BV ids of the videos to manage (ideally your own uploads)
2. Log in at bilibili.com, then copy `SESSDATA` and `bili_jct` from DevTools → Application → Cookies
3. Put them in environment variables (for example a gitignored `.env`): `BILIBILI_SESSDATA`, `BILIBILI_BILI_JCT`
4. Cookies expire; when the log shows `bilibili_login_invalid`, fetch them again

Required fields (`endpoints[i]`): `id`. Read-only public comment polling works without cookies.

## Minimal Configuration

```yaml
configVersion: 2
plugins:
  bilibili: "@zhin.js/adapter-bilibili"
bilibili:
  sendMode: review          # default; off = no outbound at all
  pollIntervalSec: 60       # minimum 60
  endpoints:
    - id: my-bilibili
      sessdata: ${BILIBILI_SESSDATA}
      biliJct: ${BILIBILI_BILI_JCT}
      videos:
        - BV1xx411c7mD       # your own videos only
```

Without cookies the adapter can still poll public comments, but it cannot identify your account (so it cannot filter self-replies) and later versions will not be able to send.

## Conversations and messages

- `conversation.kind = 'channel'`, `id = video:<aid>:<rootRpid>`, `parent = video:<aid>`
- `message.id` = comment `rpid`
- `sender` = commenter uid / nickname
- `metadata`: `resource`, `rootId`, `parentId`, `createdAt`, `likeCount`, `isUploader`

Group-style trigger rules apply: a comment thread is a shared conversation, so AI is triggered by @ / prefix by default.

## Outbound

`send({ conversation, payload })` accepts comment-thread conversations only and keeps plain text (≤1000 chars). In `review` mode it puts the reply into `endpoint.drafts` and reports "not sent, awaiting approval" via `EndpointDeliveryError('approval_pending', …, 'not_sent')`.

## Known Limitations

- Unofficial APIs; signature or field changes on Bilibili's side can break it outright
- Only the first page of each video's comments (latest 20 by time) is polled; more than 20 new comments between polls will be missed
- Seen comment ids and drafts live in process memory; a restart re-baselines and drops drafts
- Video comments (`type=1`) only

## Troubleshooting

| Symptom | Action |
|---|---|
| Log `bilibili_circuit_open` | Risk control triggered (rate limit / captcha / block / duplicate). Polling stopped: check the account on the website, complete verification if needed, raise `pollIntervalSec`, then restart |
| Log `bilibili_login_invalid` | `SESSDATA` expired; log in again and copy fresh cookies |
| Log `bilibili_no_videos` | `videos` is empty; nothing will be polled |
| AI replies don't show up on Bilibili | Expected: default `review` mode only creates drafts (`bilibili_draft_queued`); v1 never posts automatically |
