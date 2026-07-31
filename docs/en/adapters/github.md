---
title: "@zhin.js/adapter-github"
package: "@zhin.js/adapter-github"
tier: Experimental
---

::: info Documentation Sync
This page is auto-generated from [`plugins/adapters/github/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/github/README.md). Please edit the in-package README and then run `pnpm sync:adapter-docs`.
:::

<!-- sync-adapter-docs:sha256=dfc5b10c5f19d69e -->

# @zhin.js/adapter-github

GitHub Plugin Runtime adapter — Issue/PR comment sections serve as chat channels, GitHub App authentication, Webhook inbound via `httpHostToken`.

## Features

- **Chat channel**: Issue/PR comment sections are mapped as group chats, supporting message send/receive
- **Webhook inbound**: HMAC-SHA256 signature verification -> `messageGatewayToken`
- **Outbound**: `send({ target, payload })` -> Issue/PR comment (target is the channel ID)
- **GitHub App authentication**: JWT -> Installation Token
- **Agent tools**: `agent/` retains star/bind/subscribe/workspace, etc.

## Installation

```bash
pnpm add @zhin.js/adapter-github
```

Webhook requires Root to provide `@zhin.js/host-http` (`zhin runtime start` assembles it by default).

## Configuration (Plugin Runtime)

```yaml
# zhin.config.yml
plugins:
  github:
    webhook_path: /github/webhook
    auto_reply_repos:
      - zhinjs/zhin
    workspace_root: ./data/github-workspaces
    endpoints:
      - name: my-github-bot
        app_id: 123456
        private_key: ./data/github-app.pem
        webhook_secret: your-secret
```

```env
GITHUB_APP_ID=123456
GITHUB_WEBHOOK_SECRET=your-secret
```

`private_key` supports both file paths and PEM content. When `webhook_secret` is not configured, only API outbound / agent tools are available (no inbound).

Multiple Apps: a single plugin instance can attach multiple endpoints (each item in the `endpoints` array overrides top-level fields; `name` is required):

```yaml
plugins:
  github:
    endpoints:
      - name: app-a
        app_id: 123456
        private_key: ./data/app-a.pem
      - name: app-b
        app_id: 234567
        private_key: ./data/app-b.pem
```

## Removed Configuration

- **`ai.githubMcp.enabled` / `ai.githubMcp.token`**: After Plugin Runtime migration, `register-github-mcp` (stdio `@modelcontextprotocol/server-github`, PAT personal identity) has been removed, and this configuration no longer takes effect. For MCP tools, follow the new runtime `mcp/<name>.ts` (`@zhin.js/mcp-feature`) convention to set up on your own.
- **`poll_interval`**: Polling fallback has been deleted; only webhook inbound is supported. This field is currently parsed but does not take effect (deferred).

## Channel ID

| Type | Channel ID | Example |
|------|-----------|---------|
| Issue | `owner/repo/issues/N` | `zhinjs/zhin/issues/42` |
| PR | `owner/repo/pull/N` | `zhinjs/zhin/pull/108` |

## AI Tools

See `agent/tools/`: `github_star`, `github_bind`, `github_subscribe`, `github_prepare_workspace`, etc.

## Architecture

| Path | Responsibility |
|------|----------------|
| `plugin.ts` | Plugin metadata; defines `github_oauth_users` when DatabaseHost is available |
| `adapters/github.ts` | Thin `defineAdapter` entry point (convention discovery) |
| `src/endpoint.ts` | Endpoint lifecycle, outbound, admit |
| `src/webhook.ts` | HMAC signature verification and event dispatch |
| `src/oauth-users.ts` | OAuth table SSOT + token lookup |
| `src/protocol.ts` | Protocol pure functions (channel / payload) |
| `src/gh-client.ts` | GitHub API client |

- Inbound: `httpHostToken` POST -> `messageGatewayToken.receive`
- Outbound: `send({ target, payload })`

## License

MIT
