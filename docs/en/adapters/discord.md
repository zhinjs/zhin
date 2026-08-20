---
title: "@zhin.js/adapter-discord"
package: "@zhin.js/adapter-discord"
tier: Advanced
---

::: info Documentation Sync
This page is auto-generated from [`plugins/adapters/discord/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/discord/README.md). Please edit the in-package README and then run `pnpm sync:adapter-docs`.
:::

<!-- sync-adapter-docs:sha256=cc737afbe0c433c3 -->

# @zhin.js/adapter-discord

Zhin.js Discord adapter (Plugin Runtime). By default, it sends and receives messages via the **Gateway WebSocket** (discord.js), requiring no host-router / host-http.

## Features

- Gateway WebSocket inbound (default; no public HTTPS / host required)
- Parses text / mention / attachment / embed / sticker / button
- Supports private chat, group, and server channels
- Outbound `send({ conversation, payload })` -> Discord channel message (text / media / embed / keyboard)
- Convention-based `defineAdapter` / `definePlugin` (no `usePlugin` needed)
- Interactions HTTP webhook deferred (requires `httpHostToken`); configuring `connection: interactions` will produce an explicit error

## Installation

```bash
pnpm add @zhin.js/adapter-discord discord.js
```

## Plugin Runtime

- `@zhin.js/adapter` — convention-based `adapters/discord.ts` (`defineAdapter`)
- `@zhin.js/core` — `messageGatewayToken` inbound/outbound
- `zhin.js` — `plugin.ts` (`definePlugin`)
- Configuration goes to `plugins.<instanceKey>` via the plugin's `schema.json`
- **Does not require** `@zhin.js/host-http` / `@zhin.js/host-router` (Gateway path)

Inbound: `gateway.receive({ conversation, message, content, sender, metadata })` (`conversation.id` is the channelId; guild channels carry `parent`)
Outbound: `send({ conversation, payload })` -> discord.js channel.send (`conversation.id` is the channelId)

### Platform Permissions (platform permit)

- Sender role has been restored: Gateway inbound `metadata.role` / `metadata.permissions` (derived from member permission bits and guild owner detection, see `src/gateway.ts` `resolveSenderRole`).
- `plugin.ts` registers a checker during generation setup and unregisters on dispose; Plugin Runtime CapabilityIngress and ToolSystem uniformly consume `permissions` via Core's `canAccessTool()`.

## Prerequisites

| Requirement | Description |
|-------------|-------------|
| **Bot Token** | Create an application on the [Discord Developer Portal](https://discord.com/developers/applications) and obtain a Token |
| **MESSAGE CONTENT INTENT** | Must be enabled to read message content |
| **Gateway (default)** | Works for both local and production; discord.js connects to the Gateway, no public HTTPS needed |
| **host-http** | **Not needed** for Gateway; Interactions webhook deferred to next milestone |

Required fields (`endpoints[i]`): `name`, `token`.

## Minimal Configuration

```yaml
# zhin.config.yml (Plugin Runtime)
plugins:
  discord:
    # connection: gateway   # default
    endpoints:
      - name: my-discord-bot
        token: ${DISCORD_BOT_TOKEN}
```

The root plugin `zhin.plugins` (or project graph) must reference `@zhin.js/adapter-discord` (`instanceKey: discord`).

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DISCORD_BOT_TOKEN` | Bot Token |
| `DISCORD_BOT_NAME` | Optional, default endpoint name |

## Interactions (HTTP)

`connection: interactions` registers a POST route via `httpHostToken` (default `/discord/interactions`). After Ed25519 signature verification, it processes PING and slash commands; outbound uses Discord REST `channels/.../messages`. Requires `applicationId` and `publicKey` configuration.

## AI Tools (Skill)

| Category | Path |
|----------|------|
| Permit vocabulary | `agent/PERMITS.md` |
| Platform tools (7) | `agent/tools/` (`discord_*`: roles, Embed, reactions, etc.) |
| Skill documentation | `agent/skills/discord.md` |

Tools use Discord Snowflake IDs to identify `guild_id`, `user_id`, `channel_id`.

## Discord Developer Setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Create an application and obtain the Bot Token
3. Enable **MESSAGE CONTENT INTENT**
4. Invite the Bot to your server via the OAuth2 URL

## License

MIT License
