# @zhin.js/a2a

A2A v1.0 Runtime Host for Zhin.js — exposes one [Agent Card](https://a2a-protocol.org/v1.0.0/specification) per `ai.agents[]` entry.

## Routes

| Method | Path |
|--------|------|
| GET | `/a2a/{agentName}/.well-known/agent-card.json` |
| POST | `/a2a/{agentName}/jsonrpc` |
| * | `/a2a/{agentName}/rest/*` |

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

## Related

- [Agent Mesh](../../../docs/advanced/agent-mesh.md)
- [ADR 0035](../../../docs/adr/0035-a2a-agent-mesh.md)
