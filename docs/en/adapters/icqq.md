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
  master: "1659488338" # Required, shared at top level (/approve and master role)
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
  master: "1659488338" # Top-level fields are shared by all endpoints
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
- Login QR, slider, device, and auth challenges persist as Console login tasks and can also continue through terminal input.

## Console page

Open the Console **ICQQ** page (route `/icqq`) to:

- view running connections and test connectivity;
- add, edit, start, stop, replace, or remove accounts through Host runtime storage; startup configuration and `.env` remain unchanged;
- complete LoginAssist tasks (QR code, slider, SMS or device confirmation) without returning to the terminal;

An administrator must review and confirm the existing account list before its first migration; identity and history are retained. New or replaced accounts are saved disabled and must be started explicitly. A connection update reconnects only that account; replacement uses a new internal identity and does not inherit Sessions or settings. If a commit outcome is unknown, refresh to verify it before taking another action.

Reading requires `icqq:read`; writes require `icqq:write`. A full admin token is unrestricted. "Add endpoint" is equivalent to the old `icqq endpoint add` command.

First-login QR codes, slider challenges and device confirmations appear under **Pending logins**, so you do not need to return to the terminal.

## Outage notifications and re-login

With `notify` configured, ICQQ sends an out-of-band notice through another adapter instance when the account is kicked offline, login fails, or startup fails. For example, notify via a QQ official bot:

```yaml
qq:
  # ... a configured QQ official bot
icqq:
  master: 123456
  autoReconnect: true   # default true: retry login after a kickoff
  notify:
    adapter: qq
    endpoint: bot-1
    kind: private
    id: "${QQ_MASTER_OPENID}"   # master openid on the QQ official bot
```

With `autoReconnect: true`, the endpoint retries login automatically. When a QR code, slider or device confirmation is ready, the notice tells you what to send. Reply in QQ to finish login:

| Command | Purpose |
|---------|---------|
| `icqq login qr` | send the ICQQ login QR code to the current conversation (when images are supported) |
| `icqq login confirm` | confirm after scanning the QR code |
| `icqq login code <value>` | submit a slider ticket, SMS code or device-confirmation value |
| `icqq login status` | show online state and pending login tasks |
| `icqq login retry` | trigger another login attempt |

Only the master (top-level or `endpoints[i].master`) or the `notify.id` account may run these commands; when neither is configured, use the Console ICQQ page. Without `notify`, outages are only logged and shown as pending logins on the Console ICQQ page.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Login never completes | Open Console login tasks and complete QR, slider, or device confirmation |
| Signature fails | Reachability of `signApiAddr`, or installed and compatible local `@icqqjs/qqsign` |
| Login repeats after restart | Persist device and session data directories |
| Requests are missing | Endpoint request view; ICQQ reads the platform request list first |

## License

MIT
