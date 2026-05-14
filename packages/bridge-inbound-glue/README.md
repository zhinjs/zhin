# `@zhin.js/bridge-inbound-glue`

Thin glue for **Bridge v1** inbound IM handling: serialize a Core `Message` to a `dispatch` payload (`source: im`), wait for `dispatch_result` under **K1** soft timeout, write **`bridgeStatus` / `shortCircuit` / `handled`** onto a per-message carrier, and optionally **trip a circuit** that calls `BridgeSupervisor.restart()`.

See ADR [`docs/adr/0008-bridge-v1-nonebot-inbound-chain-dispatch-result.md`](../../docs/adr/0008-bridge-v1-nonebot-inbound-chain-dispatch-result.md) and GitHub issue **#409**.

## Public API

| Export | Role |
|--------|------|
| `runBridgeGlueDispatch(options)` | Imperative one-shot round-trip; returns `{ shortCircuitInbound }` for tests or custom runners. |
| `createBridgeGlueMiddleware(options)` | `MessageMiddleware` for `plugin.root.addMiddleware` — call **`next()`** unless `shortCircuitInbound` from child **ok** path. |
| `serializeMessageForBridgeDispatch(message, options?)` | Default `dispatch.payload` JSON snapshot (`$id`, `$adapter`, `$bot`, …). With `{ binarySpillover }`, returns `{ payload, spillPaths }` and applies M1 spillover (see below). |
| `clonePreservingBinary(value)` | Test / advanced: deep clone that keeps `Buffer` / `Uint8Array` leaves for spillover serialization. |

## M1 binary spillover (#410)

Large binary fields in the dispatch snapshot (for example `Message.$content[].data` as `Buffer`) would otherwise expand into huge JSON and a single NDJSON line. When **`binarySpillover`** is enabled:

- **Threshold:** `binarySpillover.maxInlineBytes` — decoded byte length **≤** this value is sent as `{ kind: 'binary_inline', encoding: 'base64', data, byteLength }`. Larger values are written to a temp file and replaced with `{ kind: 'file_ref', path, byteLength }` (`path` is absolute on the parent host).
- **Temp directory:** `binarySpillover.tmpDir`, or environment **`ZHIN_BRIDGE_TMP`**, or the OS temp directory (`os.tmpdir()`).

### Lifecycle (v1)

- **Who creates:** the **parent** process writes spill files when building the payload (before `dispatch` is framed).
- **Who reads:** the **child** should treat `file_ref.path` as **read-only** local input for this dispatch (same machine as the parent).
- **Who deletes:** the **parent** **best-effort** `unlink`s spill paths in a **`finally`** after `sendDispatch` and `waitForDispatchResult` complete (ok, timeout, or error). If the child still needed the file after a parent timeout, it may miss the file — v1 accepts this tradeoff; operators may add TTL scans under `ZHIN_BRIDGE_TMP` for orphans.
- **`buildPayload` wins:** if both `buildPayload` and `binarySpillover` are set, only `buildPayload` runs (no automatic spillover).

Wire `binarySpillover` via **`runBridgeGlueDispatch` / `createBridgeGlueMiddleware`** options alongside the session.

| `parseBridgeDispatchResultPayload(payload)` | Reads optional `shortCircuit` / `handled` from child completion payload. |
| `getBridgeInboundGlueState(message)` / `setBridgeInboundGlueState` | Read/write outcome. |

## Carrier: `WeakMap` vs `Message` fields

Outcome is stored in a **`WeakMap<Message, …>`** (see `carrier.ts`) so **`@zhin.js/core` stays free of Bridge-specific fields** and adapter-specific message extensions are not collided with. Integrators that need a stable field on the object can copy from `getBridgeInboundGlueState(message)` into their own context.

## Inbound runner placement (E1 / F2)

`runInboundMessage` in Core runs **root middleware** then the inner `next()` (dispatcher). Register **`createBridgeGlueMiddleware` toward the end** of the middleware list (after command / prompt hooks) so the glue sits **closer to `MessageDispatcher.dispatch`**. That matches the ADR: explicit **`shortCircuit`** only skips **downstream** inbound nodes (everything after this middleware’s `next()` in the onion).

## Tests

```bash
pnpm exec vitest run --config vitest.config.ts packages/bridge-inbound-glue
```

## M1 / #410 hook point

Outbound / gate work should receive **`BridgeParentSession`** (or supervisor-managed session) **plus** correlation from inbound: use the same **`BridgeGlueInstanceKey`** and the **`dispatch.id`** already tracked on `BridgeInboundGlueState.dispatchId` when wiring **`outbound_intent`** handling (see `@zhin.js/bridge-outbound-gate` and issue **#408**).
