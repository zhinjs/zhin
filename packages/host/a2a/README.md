# @zhin.js/a2a

A2A v1.0 Runtime Host for Zhin.js — exposes one [Agent Card](https://a2a-protocol.org/v1.0.0/specification) per `ai.agents[]` entry.

## Routes

| Method | Path |
|--------|------|
| GET | `/a2a/{agentName}/.well-known/agent-card.json` |
| POST | `/a2a/{agentName}/jsonrpc` |
| * | `/a2a/{agentName}/rest/*` |

REST paths are relative to the advertised `/rest` interface: `POST /message:send`,
`POST /message:stream`, `GET /tasks/{id}`, `GET /tasks`, and
`POST /tasks/{id}:cancel`. Existing `/v1/` path aliases remain accepted. Agent Cards,
REST responses and SSE events use A2A v1.0 JSON field names and enum strings;
message Parts use `{ "text": "..." }`, rather than SDK internal oneof objects.

## Setup

```yaml
http:
  token: ${HTTP_TOKEN}
  publicUrl: https://bot.example.com   # recommended behind reverse proxy

a2a:
  enabled: true
  path: /a2a

ai:
  agents:
    zhin:
      provider: ollama
      model: qwen3:8b
```

`@zhin.js/cli` is the composition root: it mounts the A2A Runtime Host when
`a2a.enabled` is enabled. Do not add `@zhin.js/a2a` to `plugins`; importing the
package is inert and only exposes the Runtime API.

Bearer `a2a.token` (or the fallback `http.token`) is required for inbound A2A
calls. Production requires one of these tokens. Without any token (development
only) the Host accepts loopback callers alone, the same rule as the MCP Host;
remote callers get `401`.

Tasks are kept in memory per agent with a hard cap (1,000) and finished tasks
expire after one hour, so `GET /tasks/{id}` for an old task returns `404`.
Streaming responses end with an SSE `event: error` frame if the agent fails
after the first chunk, and stop producing when the client disconnects.

## Remote Mailbox Transport (ADR 0048)

When collaborating across processes or machines, `@zhin.js/a2a` provides an authenticated Remote Mailbox transport (`A2AMailboxTransport`, compatible with `@zhin.js/harness` `RemoteMailTransport`). Outbound `Mail` envelopes carry HMAC-SHA256 signatures over canonical `Authority` and granted `Budget` so a remote peer cannot widen authority or exceed its budget grant:

```yaml
a2a:
  enabled: true
  mailbox:
    enabled: true
    path: /a2a/mailbox
    secret: ${A2A_MAILBOX_SECRET}
    peers:
      - actor: remote-reviewer
        url: https://agents.example.com/a2a/mailbox
        secret: ${A2A_MAILBOX_SECRET} # optional per-peer override
        token: ${REMOTE_HTTP_TOKEN}   # optional Bearer for the peer's Host
```

Credential resolution for an outbound envelope (empty strings count as unset):

- signing secret: `peer.secret` → `mailbox.secret` → `peer.token` → Host token
- Bearer: `peer.token` → Host token → the signing secret

The receiving Host verifies the Bearer against its `http.token` (falling back to
`mailbox.secret`) and the signature against `mailbox.secret`. In production the
mailbox refuses to start without a secret unless `mailbox.enabled: false`.

## Related

- [ADR 0048](../../../docs/adr/0048-agent-harness.md)
