---
title: "@zhin.js/adapter-dingtalk"
package: "@zhin.js/adapter-dingtalk"
tier: Advanced
---

::: info Documentation Sync
This page translates [`plugins/adapters/dingtalk/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/dingtalk/README.md). Keep this English page aligned with the README; `pnpm sync:adapter-docs` updates the Chinese pages.
:::

<!-- sync-adapter-docs:sha256=699f5114b36d07c9 -->

# @zhin.js/adapter-dingtalk

Zhin.js DingTalk adapter (Plugin Runtime). Sends and receives messages via the Runtime Host HTTP Webhook.

## Features

- Webhook event reception (`httpHostToken` POST + HMAC-SHA256 signature verification)
- Automatic Access Token refresh
- Session Webhook priority reply / `/robot/send` proactive sending
- Convention-based `defineAdapter` / `definePlugin` (no `usePlugin` needed)

## Installation

```bash
pnpm add @zhin.js/adapter-dingtalk
```

## Plugin Runtime

The owning `Adapter` manages desired accounts and running incarnations. The actual SDK or protocol Client implements structural `Endpoint`; framework hooks use `endpointSpec` without replacing native SDK APIs. Complete accepted callbacks enter through `events.run(...)` before deduplication and asynchronous normalization; see [Adapter authoring](/en/authoring/adapters).

- `@zhin.js/adapter` — convention-based thin entry `adapters/dingtalk/index.ts` (`defineAdapter`)
- Implementation: `src/endpoint.ts` (lifecycle/outbound/OpenAPI), `src/webhook.ts` (signature verification inbound), `src/protocol.ts`
- `@zhin.js/core` — `endpoint[endpointSpec].events.emit(...)` inbound, `outboundMessageToken` outbound
- `@zhin.js/host-http` — `httpHostToken` registers Webhook route (**not** legacy host-router/Koa)
- `zhin.js` — `plugin.ts` (`definePlugin`)
- Configuration goes to the top-level `<instanceKey>` block via the plugin's `schema.json`

Inbound: `endpoint[endpointSpec].events.emit('message.receive', { conversation, message, content, sender, metadata })` (`conversation.kind` is `group`/`private`, `conversation.id` is the conversationId)
Outbound: `send({ conversation, payload })` -> sessionWebhook or `/robot/send` (`conversation.id` is the conversationId)

## Prerequisites

1. Create an internal enterprise application / bot on the [DingTalk Open Platform](https://open.dingtalk.com/)
2. Obtain **AppKey** and **AppSecret** (optional RobotCode)
3. Set the message receiving URL to `https://your-domain/dingtalk/webhook`
4. The Runtime Host (`http`) must already be listening for the Webhook to be reachable

Required fields (`endpoints[i]`): `name`, `appKey`, `appSecret`, `webhookPath`, `robotCode`.

## Minimal Configuration

```yaml
configVersion: 2
# zhin.config.yml (Plugin Runtime)
plugins:
  dingtalk: "@zhin.js/adapter-dingtalk"
dingtalk:
  apiBaseUrl: https://oapi.dingtalk.com # optional, shared at top level
  endpoints:
    - name: my-dingtalk-bot
      appKey: ${DINGTALK_APP_KEY}
      appSecret: ${DINGTALK_APP_SECRET}
      robotCode: ${DINGTALK_ROBOT_CODE}
      webhookPath: /dingtalk/webhook # optional, default /dingtalk/webhook
```

The root plugin the main configuration `plugins` map (or project graph) must reference `@zhin.js/adapter-dingtalk` (`instanceKey: dingtalk`).

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DINGTALK_APP_KEY` | Application AppKey |
| `DINGTALK_APP_SECRET` | Application AppSecret |
| `DINGTALK_ROBOT_CODE` | RobotCode (proactive sending via `/robot/send`) |

## Message Type Mapping

| DingTalk Type | Inbound content (text summary) | Outbound wire |
|---------------|-------------------------------|---------------|
| text | Original text | text |
| picture | `[image]` | picture (requires `url`) |
| file | `[file: name]` | — |
| audio / video | `[audio]` / `[video]` | — |
| markdown | Original text or `[markdown]` | markdown |
| link | — | link |

## Agent Tools

The `agents/dingtalk/skills/` directories provide get_user, department, group chat, work notification, and related Tools. A tool declaring `adapter: 'dingtalk'` lazily receives the current operation's `DingTalkClient` through `context.$client`; the model no longer selects an Endpoint id.

## Platform Permissions (platform permit)

`plugin.ts` registers the `src/platform-permit.ts` checker during generation setup and unregisters on dispose; CapabilityIngress and ToolSystem uniformly consume tool permissions via Core's `canAccessTool()`.

## Testing

```bash
pnpm --filter @zhin.js/adapter-dingtalk build
pnpm --filter @zhin.js/adapter-dingtalk test
```

## Console page

Open the Console **DingTalk** page (route `/dingtalk`) to:

- view running connections and test connectivity;
- add, edit, start, stop, replace, or remove accounts through Host runtime storage; startup configuration and `.env` remain unchanged;
- complete LoginAssist tasks (QR code, slider or device confirmation) when the adapter asks for a login;

An administrator must review and confirm the existing account list before its first migration; identity and history are retained. New or replaced accounts are saved disabled and must be started explicitly. A connection update reconnects only that account; replacement uses a new internal identity and does not inherit Sessions or settings. If a commit outcome is unknown, refresh to verify it before taking another action.

Reading requires `dingtalk:read`; writes require `dingtalk:write`. A full admin token is unrestricted. "Add endpoint" is equivalent to the old `dingtalk endpoint add` command.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Platform URL verification fails | Public HTTPS reachability, listening HTTP Host, and exact `webhookPath` |
| Webhook returns 401/403 | `appSecret`, signature timestamp, and server clock |
| Receives but cannot reply | `robotCode`, App permissions, and session Webhook validity |
| Endpoint is missing | Schema or credential errors in Logs, then Endpoint presence in Runtime Capabilities |

Existing-group administration is in `dingtalk-group-admin`, disclosed only in group conversations. User lookup, creating a group and other common operations remain separate.
