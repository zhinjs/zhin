---
title: "@zhin.js/adapter-slack"
package: "@zhin.js/adapter-slack"
tier: Advanced
---

::: info Documentation Sync
This page is auto-generated from [`plugins/adapters/slack/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/slack/README.md). Please edit the in-package README and then run `pnpm sync:adapter-docs`.
:::

<!-- sync-adapter-docs:sha256=893adf860ad70fcb -->

# @zhin.js/adapter-slack

Zhin.js Slack adapter (Plugin Runtime). Prefers Socket Mode; can also send and receive messages via the Runtime Host HTTP Events API.

## Features

- **Socket Mode** (default): persistent WebSocket connection, no public URL needed
- **HTTP Events API**: `httpHostToken` POST (signature verification), **not** legacy host-router/Koa
- Inbound via `Endpoint.emit(...)`; outbound `send({ conversation, payload })` -> `chat.postMessage` / Block Kit
- Convention-based `defineAdapter` / `definePlugin` (no `usePlugin` needed)
- Block Kit buttons, slash commands, message editing, emoji reactions, etc. (see `agent/tools/`)

## Installation

```bash
pnpm add @zhin.js/adapter-slack
```

## Plugin Runtime

- `@zhin.js/adapter` — convention-based `adapters/slack.ts` (`defineAdapter`)
- `@zhin.js/core` — `Endpoint.emit(...)` inbound, `outboundMessageToken` outbound
- `@zhin.js/host-http` — only needed for HTTP mode to register Events route via `httpHostToken`
- `zhin.js` — `plugin.ts` (`definePlugin`)
- Configuration goes to `plugins.<instanceKey>` via the plugin's `schema.json`

Inbound: `gateway.receive({ conversation, message, content, sender, metadata })` (`conversation.id` is the channelId, threads land in `conversation.threadId`)
Outbound: `send({ conversation, payload })` -> Web API (`conversation.id` is the channel, `conversation.threadId` maps to thread_ts)

### Platform Permissions (platform permit)

- `plugin.ts` has registered a checker. Runtime Tool permissions are uniformly enforced via Core's `canAccessTool()`. When Slack inbound does not have a reliable sender role, restricted tools are denied by fail-closed policy and will not silently pass through.

## Mode Comparison

| Mode | `socketMode` | Use Case | Additional Fields |
|------|--------------|----------|-------------------|
| **Socket Mode** (default) | `true` | Local / intranet, no public URL needed | `appToken` (`xapp-...`) |
| **HTTP Events** | `false` | Production with public HTTPS | `signingSecret` + Runtime Host |

## Prerequisites

1. Create a Slack App, install it to the Workspace, and grant the required OAuth scopes.
2. Socket Mode needs a `connections:write` App-Level Token; HTTP mode needs a Signing Secret and Events URL.
3. Subscribe to required bot events and invite the App to target channels.

## Minimal Configuration (Socket Mode)

```yaml
# zhin.config.yml (Plugin Runtime)
plugins:
  slack:
    socketMode: true          # default true, can be omitted
    endpoints:
      - name: my-slack-bot
        token: ${SLACK_BOT_TOKEN}
        appToken: ${SLACK_APP_TOKEN}
```

Multiple workspaces: a single plugin instance can attach multiple endpoints (each item in the `endpoints` array overrides top-level fields; `name` is required):

```yaml
plugins:
  slack:
    endpoints:
      - name: team-a
        token: ${SLACK_BOT_TOKEN_A}
        appToken: ${SLACK_APP_TOKEN_A}
      - name: team-b
        token: ${SLACK_BOT_TOKEN_B}
        appToken: ${SLACK_APP_TOKEN_B}
```

## HTTP Events Configuration

```yaml
plugins:
  slack:
    socketMode: false
    webhookPath: /slack/events   # optional, default /slack/events
    endpoints:
      - name: my-slack-bot
        token: ${SLACK_BOT_TOKEN}
        signingSecret: ${SLACK_SIGNING_SECRET}
```

The root plugin `zhin.plugins` (or project graph) must reference `@zhin.js/adapter-slack` (`instanceKey: slack`).
In HTTP mode, the Runtime Host (`http`) must already be listening; the Slack App's Event Subscriptions / Interactivity / Slash Commands Request URL should point to `https://your-domain/slack/events`.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SLACK_BOT_TOKEN` / `SLACK_TOKEN` | Bot User OAuth Token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | App-Level Token (Socket Mode, `xapp-...`) |
| `SLACK_SIGNING_SECRET` | Signing Secret (HTTP mode) |
| `SLACK_BOT_NAME` | Optional endpoint name |

## Message Format

### Outbound (Markdown -> mrkdwn)

Common Markdown (e.g., `**bold**`) is converted to Slack mrkdwn and sent via Block Kit `section`.

### Inbound (mrkdwn -> Markdown)

| Slack mrkdwn | Common Markdown |
|--------------|-----------------|
| `*bold*` | `**bold**` |
| `_italic_` | `*italic*` |
| `~strike~` | `~~strike~~` |
| `<url\|text>` | `[text](url)` |

## AI Tools

| Category | Path |
|----------|------|
| Permit vocabulary | `agent/PERMITS.md` |
| Platform tools | `agent/tools/` (invite, topic, reactions, pin, edit, etc.) |
| Skill documentation | `agent/skills/slack.md` |

## Limitations

- Inbound mrkdwn -> Markdown conversion is heuristic
- Modals / Select menus — not yet supported
- OAuth installation flow — not yet supported
- Old `usePlugin` / `extends Adapter` / host-router production entry points have been removed

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Socket Mode cannot connect | `xapp-` token, Socket Mode, and `connections:write` scope |
| HTTP Events returns 401 | Signing Secret, raw body, server clock, and reverse proxy |
| Channel event is missing | Event subscriptions, OAuth scopes, and App channel membership |
| Reply escapes the thread | Preserve inbound `thread_ts` as Conversation `threadId` |

## License

MIT
