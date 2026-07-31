# Module-Level State and Generation

Plugins inevitably need to share runtime state: database handles, configuration snapshots, dependency packages for Agent tools. The trouble is that runtime paths like command actions, tool execute, and cron callbacks **cannot access the setup context**, so state can only live at module scope -- and bare module singletons are a high-risk zone under hot reload (HMR). `createGenerationStore` (`@zhin.js/plugin-runtime`) is designed to solve this problem.

## Anti-Pattern: Three Ways Bare Module Singletons Die

```ts
// Bad example
let _db: LotteryDb | null = null;
export function setDb(db: LotteryDb) { _db = db; }
export function getDb() { return _db; }
```

During one HMR "generation" switch (old generation assembly -> new generation activation -> old generation cleanup), this pattern has three typical failure modes.

The first is **dangling references**: after old generation cleanup, nobody clears `_db`, and new code reads the old generation's database connection -- that old connection has already been `stop()`ed, causing queries to silently fail or hit a closed handle. The second is **overwrite races**: during the period when both generations coexist (activation transaction in progress), in-flight commands from the old generation read `_db` and get the value the **new generation** just set -- cross-generation data corruption. The third is **rollback contamination**: when new generation activation fails and rolls back, restoring the old generation, `_db` has already been overwritten by the new generation, so the "revived" old generation uses abandoned new-generation resources.

These incidents have actually occurred with repeater singletons and rss `_db`. What is structurally missing is one thing: **the value's lifetime must be bound to the generation's lifetime**.

## createGenerationStore

```ts
import { createGenerationStore } from '@zhin.js/plugin-runtime';

const store = createGenerationStore<MyDeps>('my-plugin/deps');
```

A store is a **multi-generation stack** (stack of registrations):

| Method | Signature | Semantics |
| --- | --- | --- |
| `provide` | `(context, value) => Dispose` | Publishes `value` as the current generation's value, pushed to the top of the stack; when `context.lifecycle` is cleaned up (generation ends), it **automatically** removes this registration, and the previous generation's value in the stack re-emerges. The returned `Dispose` can be called manually for early removal, and is idempotent |
| `use` | `() => T` | Gets the top-of-stack live value; throws an error with the store name when no registrations exist (`Generation store "..." has no live value`) |
| `tryUse` | `() => T \| undefined` | Same as above but doesn't throw, returns `undefined` |
| `clear` | `() => void` | Clears all generations' registrations, mainly for testing |

The `context` parameter is a minimal structure `{ lifecycle: DisposeStack }` -- `PluginSetupContext` directly satisfies it. It solves the three failure modes above: **automatic cleanup on generation end** -- `provide` internally hooks the removal logic into `context.lifecycle`, no need for callers to remember to "set null on unload"; **multi-generation coexistence safety** -- during the activation transaction, both generations' registrations exist simultaneously in the stack, the new generation (stack top) takes effect, and when the new generation rolls back and is removed, the old generation's value automatically re-emerges -- rollback is naturally clean; **no dangling** -- after old generation cleanup and removal, `use()` either gets the new generation's value or throws explicitly, never silently reading a dead handle.

```mermaid
flowchart TB
  subgraph Stack (top at bottom)
    R2["Registration #2 - New generation (stack top, use() returns this)"]
    R1["Registration #1 - Old generation"]
  end
  R2 -->|"New generation lifecycle cleanup (rollback)"| X["Auto-removed → use() re-exposes Registration #1"]
```

## Positive Example: lottery's Dependency Injection

`plugins/utils/lottery/src/lottery-agent-deps.ts` is the canonical pattern. Context: lottery's Agent tools (`agent/tools/*`) have `execute` as a runtime path, where calling plugin locators is prohibited, so dependencies must be captured at setup time:

```ts
import { createGenerationStore, DisposeStack, type Dispose } from '@zhin.js/plugin-runtime';

export interface LotteryAgentDeps {
  getDb: () => LotteryDb | null;
  getConfig: () => { pickCount: number; historyLimit: number; kl8: Kl8Config };
  enabledGames: () => GameId[];
  scheduleCron: () => string;
  scheduleEnabled: () => boolean;
  pipelinePush: boolean;
}

const agentDepsStore = createGenerationStore<LotteryAgentDeps>('lottery/agent-deps');

/**
 * Generation-owned Agent dependency binding used by Plugin Runtime setup().
 * The fresh lifecycle is detached: callers own the returned dispose (setup()
 * hooks it into context.lifecycle); provide() does not retain the context.
 */
export function registerLotteryAgentDeps(deps: LotteryAgentDeps): Dispose {
  return agentDepsStore.provide({ lifecycle: new DisposeStack() }, deps);
}

export function getLotteryAgentDeps(): LotteryAgentDeps {
  const deps = agentDepsStore.tryUse() ?? _deps;
  if (!deps) throw new Error('lottery agent deps not initialized');
  return deps;
}
```

The wiring on the setup side (`plugins/utils/lottery/plugin.ts`):

```ts
context.lifecycle.add(registerLotteryAgentDeps({
  getDb: () => db,
  getConfig: () => ({ pickCount: config.pickCount, historyLimit: config.historyLimit, kl8: lotteryKl8(config) }),
  enabledGames: () => lotteryEnabledGames(config),
  scheduleCron: () => config.scheduleCron,
  scheduleEnabled: () => config.scheduleEnabled,
  pipelinePush: config.pushTargets.length > 0,
}));
```

Two details worth noting. First, `register*` returns `Dispose`, which setup hooks into `context.lifecycle` -- here `provide` uses a brand new `DisposeStack` rather than passing the setup context directly, which is intentional decoupling: the registration function does not hold a context reference, and the cleanup timing is entirely controlled by the caller (setup). The binding to the generation happens only at the `context.lifecycle.add(...)` call. Second, the runtime path (tool execute) only calls `getLotteryAgentDeps()`, and the closures it gets were captured at setup time with `db` / `config`, with no locator calls throughout.

lottery also has a second instance of the same pattern -- the database handle (`src/db-store.ts`'s `registerLotteryDb`, same "registry push + return removal function" hand-written form, hooked to `context.lifecycle`), plus the token path published to command contexts via `context.resources.provide(lotteryRuntimeToken, { db })`. The division of labor among the three channels:

| Channel | Consumer | Mechanism |
| --- | --- | --- |
| `resources.provide(token, value)` | Runtime paths that can access CapabilityContext (commands / middleware, etc.) | Scope parent-child chain resolution (see [definePlugin](./define-plugin.md)) |
| `createGenerationStore` | Runtime paths without context access (Agent tool execute, cron) | Module-level generation stack |
| `register*` hand-written registry | Same as above, lightweight scenarios | Isomorphic to store but hand-written (prefer store for new code) |

## Usage Guidelines

`provide` should only be called in setup (assembly phase); `use` / `tryUse` can be called in any runtime path. Name stores as `plugin-name/purpose` (e.g., `lottery/agent-deps`) so error messages are immediately readable. Unless you are certain that provide always precedes use, prefer `tryUse` with explicit error or degradation. In tests, use `clear()` to reset and avoid cross-test leakage. One final point that is most easily overlooked: never discard the return value of `provide` at module top level -- always hook it into `context.lifecycle` (or explicitly hold the Dispose), otherwise the cleanup semantics are effectively void.
