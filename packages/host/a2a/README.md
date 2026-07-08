# @zhin.js/a2a

A2A v1.0 server plugin for Zhin.js — exposes one [Agent Card](https://a2a-protocol.org/v1.0.0/specification) per `ai.agents[]` entry.

## Routes

| Method | Path |
|--------|------|
| GET | `/a2a/{agentName}/.well-known/agent-card.json` |
| POST | `/a2a/{agentName}/jsonrpc` |
| * | `/a2a/{agentName}/rest/*` |

## Setup

```yaml
plugins:
  - "@zhin.js/a2a"

http:
  token: ${HTTP_TOKEN}
  publicUrl: https://bot.example.com   # recommended behind reverse proxy

ai:
  agents:
    zhin:
      provider: ollama
      model: qwen3:8b
```

Bearer `http.token` is required for inbound A2A calls (except when token is empty in dev).

## Related

- [Agent Mesh](../../../docs/advanced/agent-mesh.md)
- [ADR 0035](../../../docs/adr/0035-a2a-agent-mesh.md)
