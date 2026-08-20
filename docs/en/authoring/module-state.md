# Runtime State and Generations

Database handles, configuration snapshots, and outbound ports must be bound to both a plugin **owner** and a **generation**. Runtime state has one authority: setup publishes a typed resource into the candidate Scope, and only an operation holding the committed snapshot lease may resolve it.

## Anti-pattern: a module-level "current value"

```ts
// Bare singletons, registration stacks, and createGenerationStore are not owner resources.
let currentDb: Database | undefined;
export function setDb(value: Database) { currentDb = value; }
export function getDb() { return currentDb; }
```

Module state cannot identify the calling root, plugin owner, generation, or snapshot lease. Shadow preparation may overwrite the old generation, two instances of the same package may share resources, an old request may read the new generation after commit, and rollback may reveal the wrong value. Replacing one value with a "latest registration" stack only changes overwrite order; it does not establish call identity.

## Correct model: an owner-bound resource

Define one token that aggregates the plugin's runtime capabilities:

```ts
import { createToken } from 'zhin.js/plugin-runtime';

export interface LotteryRuntime {
  readonly db: LotteryDb;
  readonly config: Readonly<LotteryConfig>;
  readonly enabledGames: readonly GameId[];
  readonly outbound: ((text: string) => Promise<void>) | null;
}

export const lotteryRuntimeToken = createToken<LotteryRuntime>(
  'zhin.lottery.runtime',
  'Owner-scoped Lottery runtime',
);
```

Setup publishes one complete runtime into the candidate generation's owner Scope:

```ts
export default definePlugin<LotteryConfig>({
  name: 'lottery',
  async setup(context) {
    const config = resolveLotteryConfig(context.config.get());
    const db = createLotteryDatabase(context);
    const outbound = createLotteryOutbound(context, config);
    const runtime = Object.freeze({
      db,
      config,
      enabledGames: Object.freeze(lotteryEnabledGames(config)),
      outbound,
    });

    context.resources.provide(lotteryRuntimeToken, runtime);
    context.resources.use(scheduleHostToken).register({
      id: 'lottery/daily-pipeline',
      cron: config.scheduleCron,
      // The callback captures this owner's runtime; it never reads module state.
      execute: () => runLotteryPipeline(runtime),
    });
  },
});
```

`resources.provide` writes only to the shadow Scope, so a failed candidate is never published. After commit, an old operation continues to hold the old snapshot while a new operation resolves the new runtime. Old resources can be disposed only after the last old lease is released.

## Commands and Tools

Commands and Tools both receive `CapabilityContext.use()` and must resolve the resource owned by their fixed snapshot:

```ts
export default defineCommand({
  description: 'Show today report',
  async execute({ use }) {
    return loadTodayReport(use(lotteryRuntimeToken).db);
  },
});

export default defineAgentTool({
  description: 'Query lottery history',
  async execute(input, context) {
    return loadDraws(context.use(lotteryRuntimeToken).db, input.game, input.count);
  },
});
```

Do not catch `use()` and fall back to a module variable. A missing token means composition is incomplete and must fail closed. A synthetic memory database, empty capability set, or "most recently registered" value disguises a configuration failure as a valid result.

## Design checks

- Does one runtime resource contain the complete DB/config/ports required by that owner?
- Does every runtime path resolve through a fixed-snapshot `CapabilityContext`, or capture the same runtime during setup?
- Can module getters, setters, and stores be deleted without pushing complexity into callers?
- Are two instances, a failed prepare, and an old operation spanning commit fully isolated?
- Does a missing resource fail explicitly instead of returning `undefined` or enabling a fallback?

If a callback "cannot access context", change the Host or Feature interface so setup injects an owner-bound closure or execution context. Do not bypass lifecycle ownership with module-global state.
