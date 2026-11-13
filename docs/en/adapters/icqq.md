---
title: "@zhin.js/adapter-icqq"
package: "@zhin.js/adapter-icqq"
tier: Advanced
---

::: info Documentation Sync
This page translates [`plugins/adapters/icqq/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/icqq/README.md). Keep this English page aligned with the README; `pnpm sync:adapter-docs` updates the Chinese pages.
:::

<!-- sync-adapter-docs:sha256=d2fc8a756013bf56 -->

# @zhin.js/adapter-icqq

ICQQ Plugin Runtime adapter — runs an [@icqqjs/icqq](https://github.com/icqqjs/icqq) `Client` directly in the Zhin process.

## Features

- Group chat / private chat / temporary group session / QQ channel messages
- Inbound native Client events enter Zhin through the single `endpoint[endpointSpec].events.emit(...)` gateway and normalize media to canonical `Segment` + `MediaRef` values
- Outbound canonical segments project to native ICQQ `Sendable` values and use `sendGroupMsg`, `sendPrivateMsg`, and the matching conversation operation
- Group reactions use `control.addReaction` and `control.removeReaction`
- Agent tools live under `tools/<name>/index.ts`
- Console Endpoint management: `src/endpoint.ts` explicitly implements `EndpointManagement` (friend/group/group member lists, request approval, delete friend, kick member, mute, set admin). Console uses standardized RPCs such as `endpoint.friends` / `endpoint.groups` / `endpoint.group_members`

## Installation

```bash
pnpm add @zhin.js/adapter-icqq @icqqjs/icqq
# Optional local signing when signApiAddr is omitted
pnpm add @icqqjs/qqsign
```

## Prerequisites

1. Prepare a QQ account and either a remote `signApiAddr` or local `@icqqjs/qqsign`.
2. Persist device and login state. Container deployments must mount the data directory.
3. First login may require QR, slider, or device confirmation through Console login tasks or the terminal.

## Configuration (Plugin Runtime)

```yaml
configVersion: 2
plugins:
  icqq: "@zhin.js/adapter-icqq"
icqq:
  autoReconnect: true
  endpoints:
    - id: "${ICQQ_ACCOUNT}" # QQ number
      # password: "${ICQQ_PASSWORD}"  # Optional; omit for QR login
```

Multiple accounts: a single plugin instance can attach multiple endpoints. Each item overrides top-level defaults and requires `id`:

```yaml
configVersion: 2
plugins:
  icqq: "@zhin.js/adapter-icqq"
icqq:
  endpoints:
    - id: "${ICQQ_ACCOUNT}"
    - id: "${ICQQ_ACCOUNT_2}"
    - id: "${ICQQ_ACCOUNT_3}"
```

`AdapterIndex` merges instance defaults with each endpoint override before invoking the adapter. The protocol accepts only that expanded endpoint configuration; it does not read environment variables or inspect nested `endpoints`. The composition root resolves environment placeholders while loading project configuration.

## Send conversation

| Type | conversation |
|------|--------------|
| Private chat | `{ kind: 'private', id: uin }` |
| Group chat | `{ kind: 'group', id: gid }` |
| Temporary group session | `{ kind: 'private', id: uin, parent: { kind: 'group', id: gid } }` |
| Channel | `{ kind: 'channel', id: channelId, parent: { kind: 'channel', id: guildId } }` |

## Architecture

- `plugin.ts` + `adapters/icqq/index.ts`: Plugin Runtime entry and `defineAdapter` declaration
- `src/endpoint.ts`: extends the actual native Client and registers framework hooks and capability ports through `endpointSpec`
- `src/content-resolver.ts`: stores observed messages and expands forwarded messages within explicit limits
- `src/icqq-inbound.ts`: normalizes native ICQQ events into Zhin inbound messages
- `src/protocol.ts`: resolves one expanded endpoint configuration and maps conversations and outbound targets
- `src/client.ts`: derives native SDK event types and registers the actual `IcqqAdapter` in the single `AdapterRegistry`

Start with `src/endpoint.ts` when reading the implementation, then follow the capability it composes. External code imports only from `@zhin.js/adapter-icqq` and the public Zhin entry points.

## Plugin Runtime Migration Notes

- The adapter no longer uses the `@icqqjs/cli` IPC daemon. It owns login state and the protocol Client in process.
- `autoReconnect` reconnects the native Client after an unexpected disconnect. `stop()` is deliberate and does not reconnect.
- With `outboundMedia: file`, base64 media is materialized to a temporary file for the duration of the send. `base64` uses ICQQ's native `base64://` file value.
- ICQQ voice, video, and file elements are standalone messages. The adapter rejects unsupported mixed sends instead of silently dropping segments.
- **Console social/group management RPC is now wired**: the endpoint within the Adapter normalizes ICQQ's `get_friend_list` / `get_group_list` / `get_group_member_list`, request approval, and group management operations into frozen `EndpointManagement` objects. The Host only consumes this semantic port and no longer probes for method aliases or reads `friends` / `groups` SDK caches.
- Friend and group requests enter the unified Endpoint event gateway and expose approval through `Request` and `EndpointManagement`.
- **Login assistance**: every login attempt is one login flow ([ADR 0058](/adr/0058-login-assist-v2)); `system.login.qrcode|slider|device|auth` become challenges of that flow that Console, the terminal and the QQ commands can answer. See [Login](#login) below.

## Console page

Open the Console **ICQQ** page (route `/icqq`) to:

- view running connections and test connectivity;
- add, edit, start, stop, replace, or remove accounts through Host runtime storage; startup configuration and `.env` remain unchanged;
- complete logins (QR code, slider, device lock, SMS, identity verification), and use **Log in again** or **Refresh QR code**;

An administrator must review and confirm the existing account list before its first migration; identity and history are retained. New or replaced accounts are saved disabled and must be started explicitly. A connection update reconnects only that account; replacement uses a new internal identity and does not inherit Sessions or settings. If a commit outcome is unknown, refresh to verify it before taking another action.

Reading requires `icqq:read`; writes require `icqq:write`. A global owner is unrestricted. Plugin permissions are granted by level (see [Plugin permission levels](../console/index.md#plugin-permission-levels)): `:read` to `viewer` and above, `:write` (`operate` level for these account permissions) to `operator` and above; a role bound to this adapter counts too, and the first migration additionally needs an administrator. "Add endpoint" is equivalent to the old `icqq endpoint add` command.

First-login QR codes, slider challenges and device locks appear under **Pending logins**, so you do not need to return to the terminal.

## Login

The adapter declares `login: { mode: 'interactive', challenges: ['qrcode', 'slider', 'device', 'auth', 'sms'], relogin: true, refreshQr: true }`. Each login attempt is one flow: connect → challenge → verifying → online or failed. After you submit, you see the real result (wrong code, too many attempts, expired, …).

| Challenge | How to finish it |
|-----------|------------------|
| QR code | Scan with mobile QQ, then confirm on the phone. After the scan the timeline shows "Scanned. Confirm the login on your phone"; after you confirm it continues by itself. If it does not, choose **I confirmed the login**. An expired QR code is replaced automatically (twice at most); after that use **Refresh QR code**. |
| Slider | In Console, open the captcha helper page (default `https://zhin.js.org/login-assist/tcaptcha.html`; set `console.loginAssist.captchaHelperUrl` to use your own); it submits the result for you, no developer tools needed. Manual fallback: open the slider link, press F12, find the `cap_union_new_verify` response in the Network panel and copy `ticket`, or paste the whole response or a link containing ticket; it is extracted for you. |
| Device lock | Scan the verification link's QR code with mobile QQ (or open it on the phone), verify, then choose **I verified on my phone**. When the SDK reports the account's phone you can choose **Use an SMS code instead**: enter the 6-digit code; **Send again** waits 60 seconds (per account; logging in again does not reset it). No SMS is sent unless you ask for one. Typing `sms` (released text-only Consoles, the terminal) also switches to an SMS code. |
| Identity verification | Follow the steps: ① copy the device JSON; ② open the verification link and go to the page that sends the code; ③ run the helper script in that page's developer tools Console (or drag it to the bookmarks bar) and paste the JSON when asked; ④ choose **Done, continue logging in**. Never paste the device JSON on other sites or send it to anyone. |

Details:

- **Slider answer format**: on the NT login path (the SDK's `sig.nt_captcha` points at this slider) the adapter submits `ticket,randstr` and asks again when randstr is missing; the legacy wtlogin path gets the ticket alone.
- **Verification links** carry a session id (sid / sig), and the account's phone number is sensitive too:
  - Zhin's own logs and `system.receive` side events carry only the challenge kind and the link's host (`{ kind, host }`): no link, phone, device information or QR image; `login.error` carries only its code and a sanitized message.
  - The icqq SDK's own logger (log4js; at `mark` level it prints slider, device-lock and identity verification links and the phone) is wrapped by the adapter: links keep only their path (the query becomes `?…`) and phone numbers become `***`.
  - **Not covered**: two places where the SDK writes to the console directly — the QR code drawn in the terminal, and `console.log(proto.toJSON())` in the legacy login's 237 branch (it may contain verification page data). They cannot be intercepted without patching the SDK; keep this in mind if console output is collected.
  - `endpoint.login.flow` events and history carry no verification links (`linkOmitted`); Console reads the current link with `login.flow.get`.
- **The device JSON** exists only on the active challenge and is cleared when it ends; it is never in Zhin's logs and never enters events or `system.receive`. The helper script is static text: it runs only on `accounts.qq.com/login/attack`, only sets `window.__INITIAL_STATE__.deviceInfo`, never submits anything and contains no device data.
- **Error codes**: `system.login.error` is mapped by one table to `code_invalid` (wrong code / ticket; the same challenge opens again), `rate_limited`, `challenge_expired`, `risk_blocked` (frozen account, blacklisted device, …), `credential_invalid` (wrong password), `network` and `unknown`. The platform's text is shown only as a sanitized one-line message without local paths.
- **Automatic relogin**: never while someone answers a challenge. A failed verification or an expired challenge stops the flow as failed / expired until you choose **Log in again** or send `icqq login retry`. Only failures that need no verification (kicked offline, network or server errors, a plain login that failed before any challenge) retry with backoff (from 5 seconds, at most 8 times), each retry on the timeline; after 8 failures the flow fails (`next: relogin`) and an outage notice says no further retry happens.
- **Wrong NT slider answer**: an NT captcha is consumed by one submission, so the adapter logs in again for a fresh slider (if that cannot start, the flow fails and waits for you); a legacy slider stays on the same challenge.
- **Incompatible token** (error 123456): logging in again reads the same token file, so the message tells you to delete `<uin>_*_token` in the data directory instead of suggesting a relogin.
- **Refresh QR code** gets a new QR code in place; other challenges cannot be refreshed alone, so it logs in again.

## Outage notifications and re-login

With `notify` configured, ICQQ sends an out-of-band notice through another adapter instance when the account is kicked offline, login fails, or startup fails. For example, notify via a QQ official bot:

```yaml
qq:
  # ... a configured QQ official bot
icqq:
  autoReconnect: true   # default true: retry login after a kickoff
  notify:
    adapter: qq
    endpoint: bot-1
    kind: private
    id: "${QQ_MASTER_OPENID}"   # master openid on the QQ official bot
```

With `autoReconnect: true`, the endpoint retries login after a kickoff. When a QR code, slider, device lock or identity verification is waiting, the notice tells you what to send. Reply in QQ to finish login:

| Command | Purpose |
|---------|---------|
| `icqq login qr` | send the ICQQ login QR code to the current conversation (when images are supported) |
| `icqq login confirm` | continue after the QR scan, device lock or identity verification |
| `icqq login code [uin] <value>` | submit a slider ticket (the whole response works too) or a 6-digit SMS code; on a device lock send `sms` to switch to an SMS code, on an SMS challenge `resend` to send it again |
| `icqq login status` | show online state, the current challenge's steps and links, and the last failure |
| `icqq login retry` | log in again (a new login flow) |

**Device lock**: `icqq login status` shows the verification link. Verify in mobile QQ, then reply `icqq login confirm`. If the link does not work, reply `icqq login code sms`, then `icqq login code <code>` once the SMS arrives. No SMS is sent unless you ask for one. Identity verification needs the device information, so finish it in Console. While a verification waits, no automatic relogin runs (it would void the link); after 5 minutes without an answer the challenge expires and waits for you to log in again.

Only the chat role `owner` or the `notify.id` account may run these commands; when neither is configured, use the Console ICQQ page. Without `notify`, outages are only logged and shown as pending logins on the Console ICQQ page.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Login never completes | Open Console login tasks and finish the QR code, slider, device lock or identity verification; when the flow stopped as failed / expired, choose **Log in again** |
| Signature fails | Reachability of `signApiAddr`, or installed and compatible local `@icqqjs/qqsign` |
| Login repeats after restart | Persist device and session data directories |
| Requests are missing | Endpoint request view; ICQQ reads the platform request list first |

## License

MIT
