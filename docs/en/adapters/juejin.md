---
title: "@zhin.js/adapter-juejin"
package: "@zhin.js/adapter-juejin"
tier: Experimental
---

::: info Documentation Sync
This page translates [`plugins/adapters/juejin/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/juejin/README.md). Keep this English page aligned with the README; `pnpm sync:adapter-docs` updates the Chinese pages.
:::

<!-- sync-adapter-docs:sha256=441bd9c4bcaa063a -->

# @zhin.js/adapter-juejin

> **Experimental** — built on Juejin's **unofficial Web APIs** and may break at any time when the site changes. Not part of the stable smoke suite; config and behavior may change incompatibly. **The real send request (reply to a comment) has not been verified over plain HTTP** — see the manual verification checklist below.

The account is managed by `JuejinAdapter`. Each endpoint is a `JuejinEndpoint`; framework lifecycle, canonical ingress and delivery go through `endpointSpec` and the AdapterIndex.

Zhin.js Juejin comment adapter (Plugin Runtime): lets AI help you reply to comments under **your own Juejin articles**. Contract: [ADR 0035: Comment-reply adapter contract](/adr/0035-comment-reply-adapter-contract). Discussion: [#971](https://github.com/zhinjs/zhin/issues/971).

## Read this first

- **It acts as your account**: Juejin has no open comment API, so sending uses your login cookie. The cookie can **only be injected through an environment variable** (e.g. `cookie: ${JUEJIN_COOKIE}`) and is never written to the data directory. A cookie is equivalent to your password: **never put it in `zhin.config.yml` as plaintext, never commit it, never paste it into logs or issues**. There is no QR login.
- **Review before sending**: `sendMode` is only `review` (default) or `off`. AI replies only go into a draft queue and are **never posted automatically**; they are sent only when you click "Send" on the Console "Juejin comment review" page or a master runs `juejin-draft send <id>`. There is no auto-send.
- **Replies only, never top-level comments**: egress can only reply to an existing comment thread (or a reply inside it) under a whitelisted article.
- **Whitelisted articles only**: only articles listed in `articles` are polled (list only your own); empty means no polling. No sitewide search, no other people's comment sections. Follow Juejin's terms; do not use it for marketing or spam.
- **Risk trips the circuit breaker**: on rate-limit / captcha / risk-control / non-JSON responses the endpoint stops polling and sending immediately and does not retry; check the account manually, then restart.

## Capabilities

| Capability | Status |
|---|---|
| Article id / `juejin.cn/post/<id>` URL parsing | ✅ |
| Poll latest comments of whitelisted articles (`interact_api/v1/comment/list`, public, no cookie) | ✅ read-only, verified live |
| One comment thread = one conversation (`article:<articleId>:<rootCommentId>`) | ✅ |
| First poll only builds a baseline; dedupe by comment id | ✅ |
| Filter your own comments (login uid, or the API's author flag) | ✅ |
| AI replies go to the draft queue (`review`) | ✅ |
| Draft persistence (survives restarts; interrupted sends are flagged) | ✅ (`data/juejin/<account>/drafts.json`, mode 600) |
| Send after master approval (`juejin-draft send` → `interact_api/v1/reply/publish`) | ⚠️ implemented but **unverified live** (send interval + circuit breaker; an unclear result is never treated as "not sent") |
| Edit / drop drafts before approval | ✅ |
| Cookie expiry detection (`err_no 403 must login`) | ✅ |
| Console "Juejin comment review" page | ✅ |
| Push new drafts / login expiry to you (`notify`) | ✅ optional |
| QR login | ❌ not provided (could not be verified safely) |
| Message-center "comments on me" notifications | ❌ not provided |

## Prerequisites

1. Your own Juejin account and the article ids to manage (the number in `https://juejin.cn/post/<id>`)
2. Read-only polling needs no login. To send: sign in on juejin.cn, copy the whole `Cookie` request header of any `api.juejin.cn` request from DevTools → Network into `.env` (gitignored): `JUEJIN_COOKIE=...`
3. Never commit the `data/` directory
4. Cookies expire; when that happens the page shows "login expired" and the log shows `juejin_login_invalid` — update the env var and restart

Required field (`endpoints[i]`): `id`.

## Minimal config

```yaml
configVersion: 2
plugins:
  juejin: "@zhin.js/adapter-juejin"
juejin:
  sendMode: review          # default; off = no egress at all. auto is not supported
  pollIntervalSec: 60       # minimum 60
  minSendIntervalSec: 30    # minimum gap between real sends, minimum 10
  notify:                   # optional: ping you about new drafts / login expiry
    adapter: icqq
    endpoint: my-qq
    id: "10001"
  endpoints:
    - id: my-juejin
      cookie: ${JUEJIN_COOKIE}   # env var only; never plaintext
      articles:
        - "7129482663794049032"  # always quote: article ids exceed JS safe integers
```

### Console "Juejin comment review" page

With the Console installed, the navigation shows "Juejin comment review": login status (with "Re-check login"), pending drafts (original comment + proposed reply) with "Send", "Edit" and "Discard", and the managed articles (read-only).

| Permission | Allows |
|---|---|
| `juejin:read` | Open the page, view status and drafts |
| `juejin:review` | Send / edit / discard drafts |
| `juejin:login` | Re-check login |

Approval commands only accept the chat role `owner` (granted on the chat adapter you use, see [Chat roles](../concepts/chat-roles.md)).

## Conversations and messages

- `conversation.kind = 'channel'`, `id = article:<articleId>:<rootCommentId>`, `parent = article:<articleId>`
- `message.id` = comment id or reply id; `sender` = author uid / name
- `metadata`: `resource` (`articleId` / `url`), `rootId`, `parentId`, `createdAt`, `likeCount`, `isAuthor`
- Replies inside a thread carry `replyTo`

## Egress

`send({ conversation, payload })` only accepts comment-thread conversations and keeps plain text (≤1000 chars). It **always** only queues the reply in `endpoint.drafts` and reports `EndpointDeliveryError('approval_pending', …, 'not_sent')`. A `reply` segment pointing at a known reply in the same thread replies to that reply; otherwise it replies to the root comment.

### Approving drafts

| Command | Effect |
|---|---|
| `juejin-draft list` | List pending drafts |
| `juejin-draft show <id>` | Show one draft |
| `juejin-draft edit <id> <text>` | Rewrite a draft (still needs `send`) |
| `juejin-draft send <id>` | Approve and send; returns the article link |
| `juejin-draft drop <id>` | Discard without sending |
| `juejin-login status` | Login status and pending count |

Send guards: `sendMode: off`, circuit open, no cookie or expired login, article no longer whitelisted, or less than `minSendIntervalSec` since the last send all refuse immediately (the draft is kept, no automatic retry). If the send response cannot be parsed (empty, non-JSON, network drop) the draft is flagged "may have been posted" and kept — **never resent automatically**; check Juejin first. Drafts interrupted by a process exit are flagged the same way on restart.

Programmatic API: `endpoint.approveDraft(id)` / `editDraft(id, text)` / `discardDraft(id)` / `recheckLogin()`.

### Risk handling and circuit breaker

Juejin publishes no error-code table. These trip the breaker (stop polling and sending, log `juejin_circuit_open`):

| Trigger | Meaning |
|---|---|
| HTTP 403 / 429 | Blocked or rate-limited |
| Non-JSON response (internal code `-2`) | Usually a verification / risk page |
| `err_msg` containing 频繁 / 过快 / 太快 / 风控 / 验证码 / 人机 / 安全验证 or captcha / verify / too many / too frequent / rate limit | Rate limit or human verification |
| Logged-in uid changed (internal code `-3`) | The cookie now belongs to another account; restart |

`err_no: 403` (`must login`) is treated as an expired login, not a trip.

## Known limitations

- Unofficial APIs; may break when Juejin changes
- Only the first page (latest 20 comments) per article is polled
- The comment list only embeds the **oldest 2** replies per comment; later replies are not ingested (`reply/list` could not be verified and is not used)
- Seen comment ids live in memory only; a restart rebuilds the baseline
- The send body comes from a community implementation ([androidZzT/juejin-mcp](https://github.com/androidZzT/juejin-mcp), which calls it inside a headless browser); **plain HTTP may need extra anti-bot signatures** and is unverified
- No QR login, no cookie renewal

## Manual verification checklist

Before the first real send, verify on a test article of your own:

1. Poll only (no `cookie`): the first poll only builds a baseline, new comments arrive, your own comments are filtered
2. Add `cookie: ${JUEJIN_COOKIE}` and click "Re-check login" in the Console: the right name / uid is shown
3. Let AI create a draft: confirm **nothing** appears on Juejin
4. Run `juejin-draft send <id>` once on your own test thread and confirm on the website that the reply sits under the right thread (not top-level)
5. If the send reports an unknown outcome or trips the breaker: do not retry; check the website and attach redacted logs to an issue

## Troubleshooting

| Symptom | Fix |
|---|---|
| Log `juejin_circuit_open` | Risk control tripped. Check the account on the website, complete any verification, raise `pollIntervalSec`, restart |
| Log `juejin_login_invalid` / "login expired" | Cookie expired; update `JUEJIN_COOKIE` and restart |
| Log `juejin_no_articles` | No `articles` configured; nothing is polled |
| AI reply not on Juejin | Expected: only a draft is queued (`juejin_draft_queued`); approve it |
| Send reports unknown outcome | The draft is flagged "may have been posted"; check Juejin before resending |
| Log `juejin_notify_failed` | The `notify` conversation could not be reached |
| Log `juejin_draft_persist_failed` | Data directory not writable; drafts stay in memory |
