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
calls. Production requires one of these tokens.

## Remote Mailbox Transport (ADR 0048)

When collaborating across processes or machines, `@zhin.js/a2a` provides an authenticated Remote Mailbox transport (`A2AMailboxTransport`, compatible with `@zhin.js/harness` `RemoteMailTransport`). Outbound `Mail` envelopes carry HMAC-SHA256 signatures over canonical `Authority` and granted `Budget` so a remote peer cannot widen authority or exceed its budget grant:

```yaml
a2a:
  enabled: true
  mailbox:
    enabled: true
    path: /a2a/mailbox
    sharedSecret: ${A2A_MAILBOX_SECRET}
    peers:
      remote-reviewer:
        url: https://agents.example.com/a2a/mailbox
        sharedSecret: ${A2A_MAILBOX_SECRET}
```

## Related

- [Agent Mesh](../../../docs/advanced/agent-mesh.md)
- [ADR 0035](../../../docs/adr/0035-a2a-agent-mesh.md)
- [ADR 0048](../../../docs/adr/0048-agent-harness.md)
