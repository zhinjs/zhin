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
  # Transport bindings only. Workroom/Project definitions stay in the
  # persistent Workroom Catalog and are never read from ai.workrooms.
  workroomRemoteExecutors:
    enabled: true
    maxResponseBytes: 1048576
    bindings:
      - endpointId: remote-reviewer
        cardDigest: sha256:${REMOTE_CARD_SHA256}
        authBindingId: callback-auth-v1
        dispatchUrl: https://agents.example.com/workroom-a2a/dispatch
        pollUrl: https://agents.example.com/workroom-a2a/poll
        credential:
          source: config
          value: ${A2A_REMOTE_TOKEN}
        authority:
          workroomExtension: https://zhin.dev/extensions/workroom-executor/v1
          idempotentDispatch: true
          typedCompletionEnvelope: true
          workspaceProviders: [github_pull_request]
        enabled: true
```

`workroomCallbacks` may remain enabled while ordinary `a2a.enabled` is false.
The callback credential is authenticated before request bytes are consumed; it
is distinct from `a2a.token`. A callback is first persisted in the durable Link
Registry / Callback Inbox, then translated through Assignment Observation
Ingress. Only the Workroom Kernel can append the resulting Assignment event.

At generation activation the Host enumerates every durable registered Link and
replays pending observations. When `workroomRemoteExecutors` is enabled, the
same fixed-generation transport is installed for durable dispatch and typed
poll recovery. Endpoint id, Agent Card digest, and auth binding must match the
persisted dispatch exactly. The optional `authority` block is required before
that endpoint can claim a new Workroom Assignment; its extension URI digest
must match `workroomCallbacks.bindings[].extensionDigest`. Omitting it keeps
callback/poll recovery available but makes new claim issuance fail closed.
A sequence gap or uncertain transport result stays
`reconcile_required` and never marks the Assignment or Task complete.

For a provider-style reference, use `source: secure_provider` with an
`env://VARIABLE_NAME` `secretRef`; the CLI resolves it once into the candidate
generation and never places the value in runtime snapshots or logs.

## Related

- [Agent Mesh](../../../docs/advanced/agent-mesh.md)
- [ADR 0035](../../../docs/adr/0035-a2a-agent-mesh.md)
