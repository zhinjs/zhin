---
title: "Module-level State"
description: "Where a plugin's database handle, config and service objects belong: why module-level variables break, and the correct pattern"
---

# Module-level state

Plugins often share things between commands, tools and schedules: a database handle, parsed config, a function that sends messages. This page answers one question: **where should those live?**

## The answer

**Create them in `setup`, publish them with `context.resources.provide(token, value)`, and read them in commands and tools with `use(token)`. Never keep them in module-level variables.**

## The correct pattern

**1. Define a token** that bundles what the plugin needs at runtime:

```ts
// src/runtime-state.ts
import { createToken } from 'zhin.js';

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

**2. Create and publish it once in `setup`:**

```ts
// plugin.ts
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

    // The schedule callback captures the same runtime instead of reading module state
    context.resources.use(scheduleHostToken).register({
      id: 'lottery/daily-pipeline',
      cron: config.scheduleCron,
      execute: () => runLotteryPipeline(runtime),
    });
  },
});
```

**3. Read it in commands and tools:**

```ts
// commands/lottery-today/index.ts
export default defineCommand({
  description: 'Show today report',
  async execute({ use }) {
    const runtime = use(lotteryRuntimeToken);
    return loadTodayReport(runtime.db);
  },
});

// tools/lottery-history/index.ts
export default defineAgentTool({
  description: 'Query lottery history',
  async execute(input, context) {
    const runtime = context.use(lotteryRuntimeToken);
    return loadDraws(runtime.db, input.game, input.count);
  },
});
```

`use()` throws when the token is missing. **Don't catch that and fall back to a module variable, fake in-memory data or an empty implementation**: a missing token means the plugin wasn't assembled correctly, and it should fail loudly rather than disguise a config error as a normal result.

## Why module-level variables break

```ts
// ❌ Don't do this
let currentDb: Database | undefined;
export function setDb(value: Database) { currentDb = value; }
export function getDb() { return currentDb; }
```

A module variable exists once, but the Zhin runtime can hold several copies of a plugin's state at the same time:

| Situation | What goes wrong with a module variable |
| --- | --- |
| A hot reload is preparing the new version | The value the old version is still using is overwritten before the new version has validated |
| The new version fails and rolls back | The variable is left holding the failed version's value |
| The same plugin is mounted twice (two `instanceKey`s) | Both instances share one variable and their data mixes |
| Old messages are still in flight during a switch | They read the new version's value halfway through |

Turning the variable into a "most recently registered" stack doesn't help — it only changes the overwrite order and still can't tell which plugin and which version a call belongs to. The same goes for global stores like `createGenerationStore`.

Values from `resources.provide` are bound to **this plugin instance at this version**: if the new version fails to prepare they never become visible; after a successful switch, old messages keep the old value and new messages get the new one; the old resources are released once the last old message finishes. See [Generation lifecycle](../concepts/generation-lifecycle.md).

## Checklist

- Does one runtime object hold all the database, config and ports the plugin needs?
- Does every execution path (commands, tools, schedules) get resources through `use()`, or capture the same runtime in `setup`?
- With every module-level getter / setter / store removed, is the business code still clear?
- Do a doubly mounted plugin, a failed hot reload and an old message spanning a switch all stay isolated from each other?
- Does a missing resource fail explicitly instead of returning `undefined` or degrading silently?

If a callback "can't reach the context", change the interface that defines it so `setup` can inject a closure or execution context with the resources already bound — don't route around the lifecycle with module globals.

## Next steps

- [definePlugin · Provide resources to your own commands and tools](./define-plugin.md#provide-resources-to-your-own-commands-and-tools)
- [Host Token reference](./host-tokens.md): what the framework lets you `use()`.
