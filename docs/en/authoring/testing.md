---
title: "Testing Plugins"
description: "Test plugins with the fake runtime in @zhin.js/plugin-test-kit: no hand-assembled contexts, no as never"
---

# Testing Plugins

You do not need to hand-assemble the `setup` context or write `as never` in plugin tests. `@zhin.js/plugin-test-kit` offers two layers:

| Layer | Use | Entry points |
| --- | --- | --- |
| **Fake runtime** (unit tests) | Fast, no test app; runs `setup()`, commands, middleware and handlers directly | `createFakePlugin` / `runPluginSetup` / `runCommand` ... |
| **Real runtime** (integration) | Real module discovery, command parsing, permissions and send chain | `PluginTestKit` |

```bash
pnpm add -D @zhin.js/plugin-test-kit
```

## Run setup

The fake uses the **real** `Scope`, `DisposeStack` and `GenerationHandoffStack`, plus the real owner-bound `databaseHostToken` / `scheduleHostToken` / `outboundHostToken` facades over in-memory process hosts.

```ts
import { runPluginSetup } from '@zhin.js/plugin-test-kit';
import plugin from '../plugin.js';

it('posts to the target group every 30 seconds', async () => {
  const fake = await runPluginSetup(plugin, { config: { target: 'g1' } });

  await fake.clock.advance(65_000);                     // advance the fake clock; due cron jobs run

  expect(fake.sent.map(call => call.kind)).toEqual(['send', 'send']);
  expect(fake.rows('notes')).toEqual([{ text: 'hello' }]); // table defined in setup
  await fake.dispose();                                  // runs lifecycle cleanups
});
```

`createFakePlugin(options)` only builds the environment. Run `fake.setup(plugin)` afterwards, or hand `fake.context` to your own function.

| Option | Effect |
| --- | --- |
| `name` / `config` | Plugin name and the value of `context.config.get()` |
| `resources` | Extra token bindings: `[fakeResource(token, value)]`, typed by the token, no assertion |
| `hosts` | `{ database, schedule, outbound }`; `false` simulates a missing host (for `resources.has()` branches) |
| `clock` | Start time or a shared `FakeClock` |

| Member | Meaning |
| --- | --- |
| `fake.context` / `resources` / `lifecycle` / `handoff` / `signal` | The parts passed to `setup` |
| `fake.database` / `schedule` / `outbound` | The same facades `resources.use(token)` returns |
| `fake.rows(name)` | Rows of a table the plugin created with `define(name)` (in-memory; `where` is equality only) |
| `fake.sent` | Every proactive send (`send`, `sendTarget`, reactions, recall, edit, typing); `sendTarget` carries the sending plugin |
| `fake.outboundHost.failNext(error)` | Make the next send reject, to test failure paths |
| `fake.clock` | `advance(ms)` moves time and runs due jobs in order; `set(time)` changes time without firing |
| `fake.scheduleHost.trigger(id)` | Run a registered job immediately |
| `fake.features` | Capabilities registered in `setup` via `addFeature` / `addCommand` etc. |
| `fake.missingRequirements(plugin)` | Tokens in `requires` that were not provided |

Cron has six fields (sec min hour day month weekday) with `*`, `*/n`, lists and ranges, evaluated in local time. `database.state` TTLs use the real `Date.now()` and are not affected by the fake clock.

## Run commands, middleware and handlers

Definitions from convention directories can be executed directly; the fake builds their context:

```ts
import { createFakeMessage, createFakePlugin, fakeResource, runCommand, runMiddleware, runHandler } from '@zhin.js/plugin-test-kit';
import checkin from '../commands/checkin/index.js';

const fake = createFakePlugin({ resources: [fakeResource(greeterToken, greeter)] });
const message = createFakeMessage({ sender: { id: 'u1', name: 'Ann', roles: ['admin'] } });

await runCommand(fake, checkin, { input: message, params: { days: 3 } });
expect(message.replies).toEqual(['checked in']);        // $reply calls are recorded

const { continued } = await runMiddleware(fake, gate, createFakeMessage({ content: 'skip' }));
expect(continued).toBe(false);                          // did the middleware call next()?

await runHandler(fake, onReceive, createFakeMessage()); // `this` is the capability context
```

::: warning This is not a full dispatch
`runCommand` calls `execute()` directly: no route matching, parameter parsing, `permit` checks or admission. Pass already-parsed `params`. To verify those, use the real runtime below.
:::

## Partial fakes: `fakeOf`

When a collaborator or event payload only needs a few members, use `fakeOf<T>({...})` instead of `{...} as never`. The cast lives in one place and call sites are still checked against `Partial<T>`:

```ts
const orchestrator = fakeOf<ActivityFeedbackOrchestrator>({ startPhase: vi.fn(), stopPhase: vi.fn() });
```

Prefer real or kit-provided fakes when they exist; keep `fakeOf` for narrow collaborators.

## Real runtime: `PluginTestKit`

The fake bypasses the renderer, outbound middleware and endpoint negotiation. To verify that a message really goes through that chain, use `PluginTestKit`: it mounts a disposable real test app and synthetic endpoints capture the final payload. See the kit [README](https://github.com/zhinjs/zhin/blob/main/packages/toolkit/plugin-test-kit/README.md) for usage and limits.

## Official example

`plugins/services/activity-feedback/tests/activity-feedback-runtime.test.ts` has been migrated: `setup` runs through `createFakePlugin` with the event bus and hosts, payloads and the orchestrator use `fakeOf`, and the file no longer contains `as never`.

## Next

- [Host Token Reference](./host-tokens.md): the tokens the fake provides.
- [Complete Plugin Delivery](./plugin-delivery.md): test and release checklist.
