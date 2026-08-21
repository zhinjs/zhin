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

## Workroom execution callbacks

Authoritative remote-execution observations use a separate exact route and a
separate credential registry. They never enter the ordinary Agent Card / JSON-RPC
handler and cannot directly change Task state:

```yaml
a2a:
  enabled: true
  workroomCallbacks:
    enabled: true
    path: /workroom-a2a/callback
    maxBodyBytes: 1048576
    maxSequenceGap: 32
    bindings:
      - endpointId: remote-reviewer
        tenantId: engineering
        cardDigest: sha256:${REMOTE_CARD_SHA256}
        authBindingId: callback-auth-v1
        trustDomain: agents.example.com
        extensionDigest: sha256:${WORKROOM_EXTENSION_SHA256}
        credentialId: remote-reviewer-callback-v1
        credential:
          source: config
          value: ${A2A_CALLBACK_TOKEN}
        enabled: true
```

`workroomCallbacks` may remain enabled while ordinary `a2a.enabled` is false.
The callback credential is authenticated before request bytes are consumed; it
is distinct from `a2a.token`. A callback is first persisted in the durable Link
Registry / Callback Inbox, then translated through Assignment Observation
Ingress. Only the Workroom Kernel can append the resulting Assignment event.

At generation activation the Host enumerates every durable registered Link and
replays pending observations. A sequence gap stays `reconcile_required`; until
an endpoint poll transport is installed, recovery fails closed without marking
the Assignment or Task complete.

## Related

- [Agent Mesh](../../../docs/advanced/agent-mesh.md)
- [ADR 0035](../../../docs/adr/0035-a2a-agent-mesh.md)
