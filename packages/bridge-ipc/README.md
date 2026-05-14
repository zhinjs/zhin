# @zhin.js/bridge-ipc

stdio **NDJSON** session between a zhin parent process and a glue child: one UTF-8 JSON object per line, terminated by `\n` (newline-delimited JSON).

## Wire protocol (v1)

### Framing

- **NDJSON**: each record is `JSON.stringify(obj) + "\n"`.
- Invalid JSON, non-object roots, or a partial line at EOF are reported as structured frame errors.

### Hello handshake (J2 / R1)

- **J2** (parent → child): first business line after spawn must be  
  `{ "kind": "hello", "protocolVersion": <number>, "token": "<shared secret>" }`.
- **R1** (child → parent):  
  - success: `{ "kind": "hello_ok", "protocolVersion": <number> }`  
  - failure: `{ "kind": "hello_error", "code": "token_mismatch" | "version_mismatch" | "invalid_hello" }`

The shared token is injected by the parent (e.g. env `ZHIN_BRIDGE_IPC_TOKEN` when spawning the reference child). For wire-level mismatch tests, the parent API supports an optional `helloToken` that overrides only the J2 frame while the child env still uses `token`.

### Post-handshake envelopes

Dispatch records use `source: "im"`. Field **`queue`** is reserved for future queue-side glue (PRD P3); v1 may send `queue: null` or omit it.

**Outbound intent** (child → parent): `{ "kind": "outbound_intent", "id": "<string>", "source": "im", "payload": { ... } }`. Optional **`correlationId`** ties a send to a prior inbound turn; omit it for proactive outbound (I2). Payload fields are validated by the parent **Outbound Gate** (bot identity, channel policy, rate limit) before mapping to Core `SendOptions` / `Adapter.sendMessage`.

## Reference child

```bash
ZHIN_BRIDGE_IPC_TOKEN='your-token' node packages/bridge-ipc/bin/echo-child.mjs
```

Completes hello against the env token, then echoes each `dispatch` as `dispatch_result` with the same `id` and `payload`.

## API

See `src/index.ts` — `BridgeParentSession`, `BRIDGE_PROTOCOL_VERSION`, and error classes for supervisor integration.
