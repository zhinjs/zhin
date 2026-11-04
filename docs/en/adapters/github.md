---
title: "@zhin.js/adapter-github"
package: "@zhin.js/adapter-github"
tier: Experimental
---

::: info Documentation Sync
This page translates [`plugins/adapters/github/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/github/README.md). Keep this English page aligned with the README; `pnpm sync:adapter-docs` updates the Chinese pages.
:::

<!-- sync-adapter-docs:sha256=dfc5b10c5f19d69e -->

# @zhin.js/adapter-github

GitHub Plugin Runtime adapter — Issue/PR comment sections serve as chat channels, GitHub App authentication, Webhook inbound via `httpHostToken`.

## Features

- **Chat channel**: Issue/PR comment sections are mapped as group chats, supporting message send/receive
- **Webhook inbound**: HMAC-SHA256 signature verification -> `endpoint[endpointSpec].events.emit(...)`
- **Outbound**: `send({ conversation, payload })` -> Issue/PR comment (`conversation.id` is the channel ID, e.g. `owner/repo/issues/42`)
- **GitHub App authentication**: JWT -> Installation Token
- **Agent tools**: `tools/` provides star, bind, subscribe, workspace, and related capabilities.

## Installation

```bash
pnpm add @zhin.js/adapter-github
```

Webhook requires Root to provide `@zhin.js/host-http` (`zhin runtime start` assembles it by default).

## Prerequisites

1. Create a GitHub App and record its App ID, private key, and Webhook Secret.
2. Grant the required Issues, Pull requests, and Contents permissions on target repositories.
3. Point Webhooks at public HTTPS `/github/webhook` and subscribe to Issue, PR, and comment events.
4. Install the App on each target repository. Repository Workrooms match stable `owner/repo` identity.

## Configuration (Plugin Runtime)

```yaml
configVersion: 2
# zhin.config.yml
plugins:
  github: "@zhin.js/adapter-github"
github:
  webhook_path: /github/webhook
  auto_reply_repos:
    - zhinjs/zhin
  workspace_root: ./data/github-workspaces
  endpoints:
    - id: my-github-bot
      app_id: "${GITHUB_APP_ID}"
      private_key: ./data/github-app.pem
      webhook_secret: "${GITHUB_WEBHOOK_SECRET}"
```

`private_key` supports both file paths and PEM content. When `webhook_secret` is not configured, only API outbound / agent tools are available (no inbound).

`AdapterIndex` merges instance defaults with each endpoint override before invoking the adapter. The protocol accepts only that expanded endpoint configuration; it does not read environment variables, inspect nested `endpoints`, or accept camelCase aliases. The composition root expands `${...}` references while loading configuration.

Multiple Apps: a single plugin instance can attach multiple endpoints. Each endpoint requires `id`, `app_id`, and `private_key`:

```yaml
configVersion: 2
plugins:
  github: "@zhin.js/adapter-github"
github:
  endpoints:
    - id: app-a
      app_id: 123456
      private_key: ./data/app-a.pem
    - id: app-b
      app_id: 234567
      private_key: ./data/app-b.pem
```

## Removed Capabilities

- **`ai.githubMcp.enabled` / `ai.githubMcp.token`**: After Plugin Runtime migration, `register-github-mcp` (stdio `@modelcontextprotocol/server-github`, PAT personal identity) has been removed, and this configuration no longer takes effect. For MCP tools, use the `mcps/<name>/index.ts` (`@zhin.js/mcp-feature`) convention.
- Polling fallback has been deleted; inbound events use Webhooks only. No inert polling configuration field remains.

## Channel ID

| Type | Channel ID | Example |
|------|-----------|---------|
| Issue | `owner/repo/issues/N` | `zhinjs/zhin/issues/42` |
| PR | `owner/repo/pull/N` | `zhinjs/zhin/pull/108` |

## AI Tools

See `tools/`: `github_star`, `github_bind`, `github_subscribe`, `github_prepare_workspace`, etc.

## Architecture

| Path | Responsibility |
|------|----------------|
| `plugin.ts` | Plugin metadata; defines `github_oauth_users` when DatabaseHost is available |
| `adapters/github/index.ts` | Thin `defineAdapter` entry point (convention discovery) |
| `src/endpoint.ts` | Endpoint lifecycle, outbound, admit |
| `src/webhook.ts` | HMAC signature verification and event dispatch |
| `src/oauth-users.ts` | OAuth table SSOT + token lookup |
| `src/protocol.ts` | Protocol pure functions (channel / payload) |
| `src/gh-client.ts` | GitHub API client |

- Inbound: `httpHostToken` POST -> `endpoint[endpointSpec].events.emit(...)`
- Outbound: `send({ conversation, payload })`

## Console page

Open the Console **GitHub** page (route `/github`) to:

- view running connections and test connectivity;
- add, edit, start, stop, replace, or remove accounts through Host runtime storage; startup configuration and `.env` remain unchanged;
- complete LoginAssist tasks (QR code, slider or device confirmation) when the adapter asks for a login;

An administrator must review and confirm the existing account list before its first migration; identity and history are retained. New or replaced accounts are saved disabled and must be started explicitly. A connection update reconnects only that account; replacement uses a new internal identity and does not inherit Sessions or settings. If a commit outcome is unknown, refresh to verify it before taking another action.

Reading requires `github:read`; writes require `github:write`. A full admin token is unrestricted. "Add endpoint" is equivalent to the old `github endpoint add` command.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Webhook returns 401 | Secret, `X-Hub-Signature-256`, and raw request body |
| App authentication fails | App ID, private-key PEM/path, and server clock |
| Comment misses the Workroom | Endpoint inbox, then Catalog Endpoint and canonical `owner/repo` |
| Receives but cannot reply | Installation and repository permissions; PAT MCP does not replace App outbound |

## License

MIT
