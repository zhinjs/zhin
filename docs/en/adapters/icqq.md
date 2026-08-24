---
title: "@zhin.js/adapter-icqq"
package: "@zhin.js/adapter-icqq"
tier: Advanced
---

::: info Documentation Sync
This page is auto-generated from [`plugins/adapters/icqq/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/icqq/README.md). Please edit the in-package README and then run `pnpm sync:adapter-docs`.
:::

<!-- sync-adapter-docs:sha256=d2fc8a756013bf56 -->

# @zhin.js/adapter-icqq

ICQQ Plugin Runtime adapter — connects to a logged-in QQ account via the [@icqqjs/cli](https://github.com/icqqjs/cli) daemon process IPC (no `httpHostToken`).

## Features

- Group chat / private chat / temporary group session / QQ channel messages
- Inbound: `outboundMessageToken` (IPC event subscription)
- Outbound: `send({ conversation, payload })` -> `send_group_msg` / `send_private_msg` / ... (`kind`/`id`/`parent` structured addressing)
- Agent tools: `agent/tools/` (poke, group management, friend list, etc.) retained
- Console Endpoint management: `src/endpoint.ts` explicitly implements `EndpointManagement` (friend/group/group member lists, request approval, delete friend, kick member, mute, set admin). Console uses standardized RPCs such as `endpoint.friends` / `endpoint.groups` / `endpoint.group_members`

## Installation

```bash
pnpm add @zhin.js/adapter-icqq
pnpm add -g @icqqjs/cli   # or npx icqq login
```

## Prerequisites

1. Prepare a QQ account and either a remote `signApiAddr` or local `@icqqjs/qqsign`.
2. Persist device and login state. Container deployments must mount the data directory.
3. First login may require QR, slider, or device confirmation through Console login tasks or the terminal.

## Configuration (Plugin Runtime)

```yaml
plugins:
  icqq:
    master: "1659488338"        # Required, shared at top level (/approve and master role)
    autoReconnect: true
    endpoints:
      - name: "${ICQQ_ACCOUNT}"   # QQ number, must match icqq login
      # rpc is an endpoint-level field:
      # - name: "${ICQQ_ACCOUNT_2}"
      #   rpc:
      #     host: 10.0.0.2
      #     port: 9527
      #     token: ${ICQQ_RPC_TOKEN}
```

Multiple accounts: a single plugin instance can attach multiple endpoints (each item in the `endpoints` array overrides top-level fields; `name` is required):

```yaml
plugins:
  icqq:
    master: "1659488338"      # Top-level fields are shared by all endpoints
    endpoints:
      - name: "${ICQQ_ACCOUNT}"
      - name: "${ICQQ_ACCOUNT_2}"
      - name: "${ICQQ_ACCOUNT_3}"   # Each account must be logged in via icqq login separately
```

Run `icqq login` first, then start Zhin.

## Send Target

| Type | target |
|------|--------|
| Private chat | `private:uin` |
| Group chat | `group:gid` |
| Temporary group session | `temp:gid:uin` |
| Channel | `channel:guildId:channelId` |

## Architecture

- `plugin.ts` + `adapters/icqq.ts` (`defineAdapter`)
- Protocol constants / configuration: `src/protocol.ts`
- IPC client: `src/ipc-client.ts` (no host-http)
- Console loginAssist / host-router deferred
- Old `usePlugin` / `extends Adapter` / Endpoint production entry points have been removed

## Plugin Runtime Migration Notes

- `autoReconnect` has been re-implemented: after an unexpected IPC/RPC disconnect, the adapter automatically reconnects with exponential backoff (`stop()` is a deliberate disconnect and does not trigger reconnection).
- `outboundMedia: file | base64` has been re-implemented: in `file` mode, segment base64 data is written to a temporary file before sending `[image:path]`; in `base64` mode (default when `rpc` is configured), `[image:base64://...]` is sent for the daemon to decode.
- **Console social/group management RPC is now wired**: the endpoint within the Adapter normalizes ICQQ's `get_friend_list` / `get_group_list` / `get_group_member_list`, request approval, and group management operations into frozen `EndpointManagement` objects. The Host only consumes this semantic port and no longer probes for method aliases or reads `friends` / `groups` SDK caches.
- Friend and group requests enter the unified Endpoint event gateway and expose approval through `Request` and `EndpointManagement`.
- Login QR, slider, device, and auth challenges persist as Console login tasks and can also continue through terminal input.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Login never completes | Open Console login tasks and complete QR, slider, or device confirmation |
| Signature fails | Reachability of `signApiAddr`, or installed and compatible local `@icqqjs/qqsign` |
| Login repeats after restart | Persist device and session data directories |
| Requests are missing | Endpoint request view; ICQQ reads the platform request list first |

## License

MIT
