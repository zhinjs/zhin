---
title: "@zhin.js/adapter-discord"
package: "@zhin.js/adapter-discord"
tier: Advanced
---

::: info Documentation Sync
This page translates [`plugins/adapters/discord/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/discord/README.md). Keep this English page aligned with the README; `pnpm sync:adapter-docs` updates the Chinese pages.
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

The owning `Adapter` manages desired accounts and running incarnations. The actual SDK or protocol Client implements structural `Endpoint`; framework hooks use `endpointSpec` without replacing native SDK APIs. Complete accepted callbacks enter through `events.run(...)` before deduplication and asynchronous normalization; see [Adapter authoring](/en/authoring/adapters).

- `@zhin.js/adapter` — convention-based `adapters/discord/index.ts` (`defineAdapter`)
- `@zhin.js/core` — `endpoint[endpointSpec].events.emit(...)` inbound, `outboundMessageToken` outbound
- `zhin.js` — `plugin.ts` (`definePlugin`)
- Configuration goes to the top-level `<instanceKey>` block via the plugin's `schema.json`
- **Does not require** `@zhin.js/host-http` / `@zhin.js/host-router` (Gateway path)

Inbound: `endpoint[endpointSpec].events.emit('message.receive', { conversation, message, content, sender, metadata })` (`conversation.id` is the channelId; guild channels carry `parent`)
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
configVersion: 2
# zhin.config.yml (Plugin Runtime)
plugins:
  discord: "@zhin.js/adapter-discord"
discord:
  # connection: gateway   # default
  endpoints:
    - name: my-discord-bot
      token: ${DISCORD_BOT_TOKEN}
```

The root plugin the main configuration `plugins` map (or project graph) must reference `@zhin.js/adapter-discord` (`instanceKey: discord`).

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
| Permit vocabulary | `PERMITS.md` |
| Platform tools (7) | `tools/` (`discord_*`: roles, Embed, reactions, etc.) |
| Skill documentation | `agents/discord/skills/discord/SKILL.md`、`agents/discord/skills/discord-guild/SKILL.md` |

Tools use Discord Snowflake IDs to identify `guild_id`, `user_id`, `channel_id`.

## Discord Developer Setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Create an application and obtain the Bot Token
3. Enable **MESSAGE CONTENT INTENT**
4. Invite the Bot to your server via the OAuth2 URL

## Console page

Open the Console **Discord** page (route `/discord`) to:

- view running connections and test connectivity;
- add, edit, start, stop, replace, or remove accounts through Host runtime storage; startup configuration and `.env` remain unchanged;
- complete LoginAssist tasks (QR code, slider or device confirmation) when the adapter asks for a login;

An administrator must review and confirm the existing account list before its first migration; identity and history are retained. New or replaced accounts are saved disabled and must be started explicitly. A connection update reconnects only that account; replacement uses a new internal identity and does not inherit Sessions or settings. If a commit outcome is unknown, refresh to verify it before taking another action.

Reading requires `discord:read`; writes require `discord:write`. A full admin token is unrestricted. "Add endpoint" is equivalent to the old `discord endpoint add` command.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Gateway repeatedly disconnects | Token, proxy, Gateway Intents, and Developer Portal settings |
| Online but message body is absent | Enable Message Content Intent and channel read permission |
| Receives but cannot send | Send Messages, Embed Links, and attachment permissions |
| `connection: interactions` fails | Use the production `gateway` path |

## License

MIT License

Group/channel-specific Skills and their private Tools are disclosed only in their declared scenes. Common lookup and messaging stay separate. See [Agent capabilities](../authoring/agent-tools.md) for classification.
