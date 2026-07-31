---
title: "@zhin.js/adapter-dingtalk"
package: "@zhin.js/adapter-dingtalk"
tier: Advanced
---

::: info Documentation Sync
This page is auto-generated from [`plugins/adapters/dingtalk/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/dingtalk/README.md). Please edit the in-package README and then run `pnpm sync:adapter-docs`.
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

- `@zhin.js/adapter` — convention-based thin entry `adapters/dingtalk.ts` (`defineAdapter`)
- Implementation: `src/endpoint.ts` (lifecycle/outbound/OpenAPI), `src/webhook.ts` (signature verification inbound), `src/protocol.ts`
- `@zhin.js/core` — `messageGatewayToken` inbound/outbound
- `@zhin.js/host-http` — `httpHostToken` registers Webhook route (**not** legacy host-router/Koa)
- `@zhin.js/plugin-runtime` — `plugin.ts` (`definePlugin`)
- Configuration goes to `plugins.<instanceKey>` via the plugin's `schema.json`

Inbound: `gateway.receive({ adapter, target: conversationId, content: text, sender, metadata })`
Outbound: `send({ target, payload })` -> sessionWebhook or `/robot/send`

## Prerequisites

1. Create an internal enterprise application / bot on the [DingTalk Open Platform](https://open.dingtalk.com/)
2. Obtain **AppKey** and **AppSecret** (optional RobotCode)
3. Set the message receiving URL to `https://your-domain/dingtalk/webhook`
4. The Runtime Host (`http`) must already be listening for the Webhook to be reachable

Required fields (`endpoints[i]`): `name`, `appKey`, `appSecret`, `webhookPath`, `robotCode`.

## Minimal Configuration

```yaml
# zhin.config.yml (Plugin Runtime)
plugins:
  dingtalk:
    apiBaseUrl: https://oapi.dingtalk.com # optional, shared at top level
    endpoints:
      - name: my-dingtalk-bot
        appKey: ${DINGTALK_APP_KEY}
        appSecret: ${DINGTALK_APP_SECRET}
        robotCode: ${DINGTALK_ROBOT_CODE}
        webhookPath: /dingtalk/webhook   # optional, default /dingtalk/webhook
```

The root plugin `zhin.plugins` (or project graph) must reference `@zhin.js/adapter-dingtalk` (`instanceKey: dingtalk`).

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

The `agent/` directory is retained (get_user, departments, group chat, work notifications, etc.). The Endpoint self-registers to `dingtalk-agent-deps` at `start`.

## Platform Permissions (platform permit)

`plugin.ts` registers the `src/platform-permit.ts` checker during generation setup and unregisters on dispose; CapabilityIngress and ToolSystem uniformly consume tool permissions via Core's `canAccessTool()`.

## Testing

```bash
pnpm --filter @zhin.js/adapter-dingtalk build
pnpm --filter @zhin.js/adapter-dingtalk test
```
