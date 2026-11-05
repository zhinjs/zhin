---
title: "Generation and Lifecycle"
description: "Why hot reload never interrupts messages in flight, why the old version keeps serving when new code fails, and why plugin resources must register cleanup"
---

# Generation and lifecycle

Edit a command file and there is no process restart, and messages being handled aren't cut off. That's because startup, hot reload and config changes all take the same internal path: build the new version **completely** in the background, then switch over in one step. Each version is called a **generation**.

## What you will observe

| You… | What happens |
| --- | --- |
| Save a command, middleware or tool file | Only the affected part is rebuilt; it's live within a fraction of a second, no restart |
| Change one plugin's config in `zhin.config.yml` | That plugin is rebuilt; an invalid new config keeps the old one |
| Ship code that throws, a missing dependency, a failed external connection | The switch is cancelled, **the old version keeps serving**, and the terminal prints the error |
| Have messages in flight during the switch | They finish on the old version; new messages use the new one |
| Add or remove child plugins, or change the structure in `package.json#zhin` | Beyond what hot reload can safely handle — the CLI restarts the process |

Plugin authors have one obligation: **resources acquired in `setup` (timers, connections, registrations) must be released through `context.lifecycle` or the function `setup` returns.** See [Why resources must be attached to lifecycle](#why-resources-must-be-attached-to-lifecycle).

The rest of this page explains how the mechanism works, for readers who want the details or plan to contribute.

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

During a hot reload, platform connections are never torn down before the new generation is ready:

1. The candidate `AdapterIndex` completes `start()` and `open()` during `activateNext`, while its `GenerationAdmissionGate` remains closed before `commit`.
2. When `SnapshotStore` publishes the new snapshot, it synchronously opens the new admission gates and closes replaced gates; projections retained across both generations are reused without interruption.
3. Every configured Endpoint is a required prerequisite: if creating, starting, or opening an Endpoint fails, the candidate generation is rejected and the previous generation keeps serving.
4. After commit, retired Endpoints drain alongside in-flight snapshot leases and are then closed and stopped by the old generation's disposer. The shared HTTP listener, Console RPC, and SSE streams belong to the Process Host and remain available across reloads.

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

### Plugin `hmr.pause` and `hmr.resume` hooks

Plugins that maintain their own background queues can subscribe to `hmr.pause` (before candidate setup) and `hmr.resume` (after commit or rollback) inside `setup({ events })`. Because these handlers run inside the serialized Root control queue, keep them to fast local checkpoints — do not call Runtime control methods recursively or block on slow external I/O inside the handler.

## Why Resources Must Be Attached to Lifecycle

Hot reload = old generation destroyed, new generation rebuilt. If a plugin stores resources in **module-level variables** (`let _db = ...`), when the module is reloaded the old variable dies with the old generation, but some callbacks still hold references to it -- this is the classic cause of "ghost singleton" incidents (timers firing repeatedly, using an already-closed database connection).

The rule is simple: **all resources with a lifecycle must be registered in `context.lifecycle` (a `DisposeStack`)**, and they are automatically deregistered when the generation ends.

Cross-module generation state must be provided as a snapshot Resource and resolved through the
`GenerationView` held by the current operation. Module-level latest-value stacks,
`createGenerationStore`, and any “current live generation” lookup are forbidden: they cannot
isolate multiple Roots and can expose a shadow candidate before commit.
