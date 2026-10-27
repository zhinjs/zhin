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

> **Experimental** — built on Bilibili's **unofficial Web APIs** (including the QR login API) and may break at any time when the site changes. Not part of the stable smoke suite; config and behavior may change incompatibly.

Zhin.js Bilibili comment adapter (Plugin Runtime): lets AI help you reply to comments under **your own videos**. Contract: [ADR 0035: Comment-reply adapter contract](/adr/0035-comment-reply-adapter-contract). Discussion: [#971](https://github.com/zhinjs/zhin/issues/971).

## Read this first

- **It acts as your account**: Bilibili's open platform grants no comment read/write scopes, so this adapter uses your login cookies (`SESSDATA` + `bili_jct`). The recommended way is **QR login** on the Console "Comment review" page; the credentials stay only in the data directory of the machine running the bot (`data/bilibili/<account>/credentials.json`, mode 600). Environment variables still work. Treat cookies like a password: **never put them in `zhin.config.yml` in plain text, commit them, or paste them into logs or issues.**
- **Review before send by default**: `sendMode` defaults to `review`. AI-written replies only land in a draft queue and are **never posted to Bilibili automatically**; they are posted only when you press Send on the Console "Comment review" page or a master runs `bili-draft send <id>`. There is no auto-send.
- **Allow-listed videos only**: only the videos listed in `videos` are polled (ideally your own uploads). No site-wide search, no posting in other people's comment sections. Follow Bilibili's user agreement — no marketing, lead generation, or spam.
- **Risk control trips a breaker**: on rate-limit / captcha / risk-block / duplicate-comment codes the endpoint stops polling and logs an error with no automatic retry; restart after checking the account manually.

## Current capabilities

| Capability | Status |
|---|---|
| BV id → aid | ✅ |
| Poll latest comments on allow-listed videos (`x/v2/reply`, video `type=1` only) | ✅ read-only |
| Detect own uid from the login, skip own comments | ✅ |
| One comment thread = one conversation (`video:<aid>:<rootRpid>`) | ✅ |
| First poll only records a baseline (history is not fed to AI) | ✅ |
| AI replies go to a draft queue (`review`) | ✅ |
| Draft persistence (survives restarts; interrupted sends are flagged) | ✅ `data/bilibili/<account>/drafts.json` |
| Posting after master approval (`bili-draft send` → `x/v2/reply/add`) | ✅ with send interval and risk breaker |
| Edit / discard drafts before sending (`bili-draft edit` / `drop`) | ✅ |
| QR login / cookie persistence (Console page or `bili-login start`) | ✅ environment variables still work and take precedence |
| Expired-cookie detection: clear stale credentials, ask you to scan again | ✅ |
| Console "Comment review" page: login status, watched videos, send / edit / discard drafts | ✅ |
| Push new drafts / expired login to you (`notify`) | ✅ optional, via the unified outbound pipeline to a chat you choose |
| "Replies to me / @me" notifications (`x/msgfeed/reply`, `x/msgfeed/at`) | ✅ needs a login, off by default, video comments only |
| Dynamic / article comments | 🚧 v1.1 |

## Prerequisites

1. Your own Bilibili account and the BV ids of the videos to manage (ideally your own uploads)
2. Pick one way to sign in:
   - **QR login (recommended)**: after starting, open the Console "Comment review" page, press "Sign in with QR code", and confirm in the Bilibili app; or send `bili-login start` to the bot in a private chat (the QR code is only sent in private chats)
   - **Environment variables**: log in at bilibili.com, copy `SESSDATA` and `bili_jct` from DevTools → Application → Cookies, and put them in a gitignored `.env`: `BILIBILI_SESSDATA`, `BILIBILI_BILI_JCT`
3. Keep the `data/` directory out of the repository (projects from `create-zhin-app` already ignore it; check `.gitignore` in your own projects)
4. Cookies expire; the page then shows "Login expired" and the log shows `bilibili_login_invalid` — scan again

Required fields (`endpoints[i]`): `id`. Read-only public comment polling works without signing in.

## Minimal Configuration

```yaml
configVersion: 2
plugins:
  bilibili: "@zhin.js/adapter-bilibili"
bilibili:
  sendMode: review          # default; off = no outbound at all
  pollIntervalSec: 60       # minimum 60
  minSendIntervalSec: 30    # minimum gap between two approved posts, at least 10
  notifications: [reply, at]  # optional: also receive "replies to me / @me"; off by default
  notify:                   # optional: tell you about new drafts / expired login
    adapter: icqq           # the adapter you chat with the bot through
    endpoint: my-qq         # that adapter's endpoints[i].id
    id: "10001"             # your account (private chat)
  endpoints:
    - id: my-bilibili
      videos:
        - BV1xx411c7mD       # your own videos only
      # Only when using environment variables instead of QR login:
      # sessdata: ${BILIBILI_SESSDATA}
      # biliJct: ${BILIBILI_BILI_JCT}
```

After starting, open "Comment review" in the Console and scan the QR code. Without signing in the adapter can still poll public comments, but it cannot identify your account (so it cannot filter self-replies), send, or receive "replies to me / @me".

### Login and credentials

- **Precedence**: a valid cookie from config / environment variables wins over stored QR credentials; when none is configured or it has expired, the stored QR login is used.
- **Location**: `<endpoint id>/credentials.json` under `dataDir` (default `data/bilibili`, relative to the working directory), file mode 600. Never in YAML or logs.
- **Expiry**: when the startup check or a send reports "not logged in", stale QR credentials are deleted, the page shows "Login expired", and `notify` asks you to scan again. Drafts are kept.
- **Sign out**: "Sign out" on the Console page deletes the stored QR credentials; cookies from environment variables can only be changed there.
- **QR safety**: the QR image is rendered locally, never sent to a third-party QR service or written to logs; `bili-login start` only answers in private chats.

### Console "Comment review" page

With the Console installed, "Comment review" appears in the navigation (route is the plugin path, such as `/bilibili`). There you can:

- See the login status; sign in with a QR code, scan again, or sign out
- Review pending replies: the original comment and the AI's proposed reply, with Send / Edit / Discard
- See the watched videos (read-only; edit the config to change them)

The page refreshes every 10 seconds (2 seconds while scanning), so new drafts appear automatically.

Permissions (grant them to user tokens in `http.tokens[].permissions`; full tokens are unrestricted):

| Permission | Allows |
|---|---|
| `bilibili:read` | Open the page, read status and drafts |
| `bilibili:review` | Send / edit / discard drafts |
| `bilibili:login` | QR login / sign out |

Review commands require the master role: set yourself as `master` in the config of the chat adapter you talk to the bot through (QQ / Telegram, …); `bilibili.master` is a Bilibili uid and lets you run the commands from comments. With no master configured, nobody can send via commands.

## Conversations and messages

- `conversation.kind = 'channel'`, `id = video:<aid>:<rootRpid>`, `parent = video:<aid>`
- `message.id` = comment `rpid`
- `sender` = commenter uid / nickname
- `metadata`: `resource`, `rootId`, `parentId`, `via` (`video` / `reply` / `at`), `createdAt`, `likeCount`, `isUploader`
- Comments from "replies to me / @me" carry `mentioned: true`; nested replies carry `replyTo`

Group-style trigger rules apply: a comment thread is a shared conversation, so AI is triggered by @ / prefix by default; "replies to me / @me" count as @-ing the bot.

### Replies to me / @me

With `notifications: [reply, at]`, each poll also reads one page of `x/msgfeed/reply` / `x/msgfeed/at`:

- The first poll only records a baseline; afterwards only new notifications are admitted
- Video comments only (dynamic / article notifications are ignored)
- `notificationScope: whitelist` (default) admits only notifications under videos in `videos`; `all` admits every video-comment notification (for example replies to your comment under someone else's video)
- A comment seen by both the video poll and a notification is admitted once

## Outbound

`send({ conversation, payload })` accepts comment-thread conversations only and keeps plain text (≤1000 chars). It **always** only puts the reply into `endpoint.drafts` and reports "not sent, awaiting approval" via `EndpointDeliveryError('approval_pending', …, 'not_sent')`. A `reply` segment (comment rpid) in the payload targets that nested comment; otherwise the reply goes to the thread root.

### Reviewing drafts

The Console "Comment review" page is the easiest way; commands also work (master-only, from any connected chat platform):

| Command | What it does |
|---|---|
| `bili-draft list` | List pending drafts (id, quoted original comment, proposed reply) |
| `bili-draft show <id>` | Show one draft in full |
| `bili-draft edit <id> <new text>` | Rewrite a draft; it still needs `send` |
| `bili-draft send <id>` | Approve and post (`x/v2/reply/add`); returns the comment link |
| `bili-draft drop <id>` | Discard without sending |
| `bili-login start [account]` | QR login (the QR code is only sent in private chats) |
| `bili-login status` | Show the login status and pending count |

Drafts are stored in `data/bilibili/<account>/drafts.json` and restored on restart (the latest 200 are kept). A draft whose send was interrupted by a process exit is flagged "last send was interrupted and may have been posted"; check Bilibili before sending it again.

Send guards: `sendMode: off`, an open breaker, no valid login, or less than `minSendIntervalSec` since the last post are refused outright (the draft is kept; no queueing, no automatic retry). A risk-control code while posting trips the breaker for the whole endpoint.

Code can call `endpoint.approveDraft(id)` / `editDraft(id, text)` / `discardDraft(id)` and `startQrLogin()` / `logout()` directly.

### Notifications to you

With `notify` configured, these events send one message to that conversation through the unified outbound pipeline (`OutboundHost`):

- A new draft: original comment excerpt, proposed reply, how to approve
- Expired login: scan again (or update the environment variables)
- QR login succeeded

Without `notify`, drafts only show on the Console page and in logs (`bilibili_draft_queued`). A failed notification is only logged and never affects the draft.

## Known Limitations

- Unofficial APIs; signature, field, or QR-flow changes on Bilibili's side can break it outright
- Only the first page of each video's comments (latest 20 by time) is polled; more than 20 new comments between polls will be missed
- Seen comment ids and notification baselines live in memory; a restart re-baselines (old comments from the downtime are not handed to AI)
- No automatic cookie refresh; scan again after expiry
- "Replies to me / @me" reads only the first notification page per poll
- Video comments (`type=1`) only

## Troubleshooting

| Symptom | Action |
|---|---|
| Log `bilibili_circuit_open` | Risk control triggered (rate limit / captcha / block / duplicate). Polling stopped: check the account on the website, complete verification if needed, raise `pollIntervalSec`, then restart |
| Log `bilibili_login_invalid` / page shows "Login expired" | The cookie expired. Scan again for QR logins; update the environment variables (or remove them and scan) otherwise |
| QR login says Bilibili risk control blocked it | The QR API is rate-limited; wait a few minutes and retry |
| Log `bilibili_no_videos` | `videos` is empty; nothing will be polled |
| AI replies don't show up on Bilibili | Expected: only drafts are created (`bilibili_draft_queued`); press Send on the Console page or run `bili-draft send <id>` |
| No "Comment review" in the Console | Make sure the Console (`@zhin.js/page`) is installed and the token has `bilibili:read` |
| Page buttons say you lack permission | The token lacks `bilibili:review` / `bilibili:login` |
| `bili-draft send` says it is too soon | `minSendIntervalSec` has not passed; try again later, the draft is kept |
| `bili-draft` reports no permission | You are not a master; set `master` in your chat adapter config |
| Log `bilibili_notifications_disabled` | `notifications` is on but you are not signed in, so notifications are not polled |
| Log `bilibili_notify_failed` | The `notify` conversation cannot be reached: check adapter / endpoint / id and that the adapter is online |
| Log `bilibili_draft_persist_failed` | The data directory is not writable; check `dataDir` permissions. Drafts remain in memory |

## References

The QR login and overall flow borrow ideas (flow only — no copied code, no dependency) from [renmu123/biliAPI](https://github.com/renmu123/biliAPI) (WebQrcodeLogin), [WittF/bilibili-qr-login](https://github.com/WittF/bilibili-qr-login), [Ninzore/bilibili-captain](https://github.com/Ninzore/bilibili-captain) (Login.loginQR) and [Janson20/BiliCommentBot](https://github.com/Janson20/BiliCommentBot). The community API docs SocialSisterYi/bilibili-API-collect are archived; this adapter does not depend on them. Endpoints may change at any time — see the Experimental note at the top.
