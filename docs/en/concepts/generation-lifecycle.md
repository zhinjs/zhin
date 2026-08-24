# Generation and Lifecycle

After modifying a command file, you don't need to restart the process, and in-flight messages won't be cut off mid-way -- because startup, hot reload, and configuration changes all follow the same path in the runtime: a **generation transaction**. The new generation is fully built in a "shadow" first, then an atomic handoff is performed. At any moment there is exactly one current generation in the process; if the handoff fails, the old generation continues serving as-is -- there is no half-new, half-old intermediate state.

## Snapshot: The World State of a Generation

Each generation is an immutable `RuntimeSnapshot` (import types from `zhin.js`):

```ts
interface RuntimeSnapshot {
  readonly generation: number;                       // Generation number, monotonically increasing from 0
  readonly root: PluginId;
  readonly tree: ReadonlyMap<PluginId, PluginNodeSnapshot>;   // Plugin tree
  readonly config: ReadonlyMap<PluginId, unknown>;            // Each plugin's ConfigView
  readonly resources: ReadonlyMap<PluginId, ReadonlyMap<TokenId, unknown>>;
  readonly capabilities: ReadonlyMap<CapabilityId, CapabilitySlot>;
  readonly projections: ReadonlyMap<FeatureId, unknown>;      // AdapterIndex, CommandIndex...
}
```

Snapshot collections use read-only views. Serializable descriptors must be immutable, while stateful Resources are exposed only through controlled interfaces. Plugin code always sees one fixed generation world.

`RuntimeSnapshot` and Runtime sidecars such as ownership and the generation model form one
`CommittedGeneration`. Root swaps this complete record, so commit observers cannot see a new
snapshot paired with previous-generation sidecars.

## One Atomic Publish Point

`RootController` serializes all control operations (promise queue), executing the same pipeline for each transaction:

```mermaid
sequenceDiagram
    participant C as RootController
    participant P as prepare (shadow build)
    participant H as GenerationHandoff
    participant S as SnapshotStore

    C->>P: prepare(current)
    Note over P: Scan plugin graph, compose config, create scope,<br/>project Features... all lazy, invisible externally
    P-->>C: PreparedGeneration (with handoff + dispose)
    C->>H: activateNext(signal)
    Note over H: Complete every fallible readiness step<br/>in forward order; candidate admission stays closed
    C->>S: commit (switch snapshot and all admission gates, generation+1)
    Note over S: commit is the final synchronous, infallible publish point;<br/>old resources drain with their last lease
    alt Prepare or readiness fails
        C->>H: deactivateNext() (if already activated)
        C->>P: prepared.dispose() (destroy shadow)
        Note over C: Old generation continues running,<br/>transaction is fully cancelled
    end
```

The corresponding code skeleton (`RootController.transact`):

```ts
const previous = this.snapshots.acquire();
try {
  prepared = await prepare(previous.value, signal);
  if (!prepared) return previous.value;      // No changes, return directly
  if (prepared.handoff) {
    await prepared.handoff.activateNext(signal);
  }
  return this.#commitGeneration(previous.value.generation, prepared);
} catch (error) {
  return this.#rollback(prepared, { activated }, error);
} finally {
  previous.release();
}
```

`GenerationHandoffStack` composes candidate readiness only: `activateNext` runs in forward order and a failure deactivates every successfully activated participant in reverse order. The previous generation is never touched during the transaction. If compensation also fails, Root fails closed and accepts no new operations.

### Adapter Admission Switches Atomically with the Snapshot

`@zhin.js/adapter` does not close the old Endpoint before commit. The candidate
`AdapterIndex` completes `start()` and `open()` during `activateNext`, but its
`CapabilityContext` injects a `OutboundMessageService` bound to the candidate generation's
`GenerationAdmissionGate`; every inbound event fails closed before commit. When
`SnapshotStore` publishes the new snapshot it synchronously closes removed gates and opens
new gates. A projection retained by both generations is never closed briefly.

The old generation therefore remains available throughout preparation. Failed activation only
stops the candidate. After commit, the old Endpoint may drain with old snapshot leases; late
events are rejected by its retired gate, and its disposer eventually runs `close()` / `stop()`.
Adapters have no dedicated `quiescePrevious`, `resumePrevious`, or post-commit `openNext` phase.
Every configured Endpoint is a required prerequisite: create, start, or open failure rejects the
candidate generation. No inert/unconfigured record or background late-open is published.
The shared HTTP listener belongs to the Process Host. Candidate generations receive only an
`HttpHost` routing port; gated HTTP/WS registrations cannot shadow an old route before commit, and
generation code has no listener `listen`/`close` authority.

## Snapshot Leases: In-Flight Messages Are Not Interrupted

Committing only switches the pointer -- the old generation is not destroyed immediately since it may still be serving in-flight messages. `SnapshotStore` manages this with leases:

- `acquire()` obtains the current generation snapshot and increments the reference count; call `release()` when done;
- A replaced old generation is marked as retired and only truly `dispose()`d when the lease count reaches zero;
- `RootController.stop()` waits for all historical generations to be released before returning, so shutdown does not cut off resources mid-message-processing.

## HMR Semantics

`HmrCoordinator` (`@zhin.js/runtime`) watches for file changes, merges a batch of filesystem events from the same operation into a single transaction, and then uses `InvalidationPlanner` to plan the invalidation scope:

- **Generation-level**: Changes only affect certain plugin subtrees or capability slots -- only the affected parts are rebuilt (subtree / slot / topology, three kinds of preparers), going through the handoff described above;
- **Process-level**: Changes that the module loader cannot safely invalidate, or manifest topology changes that cross the restart boundary (determined by `RestartBoundaryPlanner`, e.g., adding/removing child plugin dependencies) -- handed to `onRestartRequired`, with the outer layer (CLI) restarting the process.

A failed HMR transaction cancels the remaining changes in the batch and invokes `onError`; it will not silently replay. HMR stop closes admission and awaits the in-flight reload. Once a process restart is required, the coordinator rejects further generation work. Post-commit Console or logging observer failures are diagnostic only and cannot rewrite a committed reload as failed.

## Why Resources Must Be Attached to Lifecycle

Hot reload = old generation destroyed, new generation rebuilt. If a plugin stores resources in **module-level variables** (`let _db = ...`), when the module is reloaded the old variable dies with the old generation, but some callbacks still hold references to it -- this is the classic cause of "ghost singleton" incidents (timers firing repeatedly, using an already-closed database connection).

The rule is simple: **all resources with a lifecycle must be registered in `context.lifecycle` (a `DisposeStack`)**, and they are automatically deregistered when the generation ends.

Cross-module generation state must be provided as a snapshot Resource and resolved through the
`GenerationView` held by the current operation. Module-level latest-value stacks,
`createGenerationStore`, and any “current live generation” lookup are forbidden: they cannot
isolate multiple Roots and can expose a shadow candidate before commit.
