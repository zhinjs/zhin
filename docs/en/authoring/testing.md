---
title: "Testing Plugins"
description: "Test plugins with the fake runtime in @zhin.js/testing: no hand-assembled contexts, no as never"
---

# Testing Plugins

You do not need to hand-assemble the `setup` context or write `as never` in plugin tests. `@zhin.js/testing` offers two layers:

| Layer | Use | Entry points |
| --- | --- | --- |
| **Fake runtime** (unit tests) | Fast, no test app; runs `setup()`, commands, middleware and handlers directly | `createFakePlugin` / `runPluginSetup` / `runCommand` / `runTool` ... |
| **Real runtime** (integration) | Real module discovery, command parsing, permissions and send chain | `PluginTestKit` |

```bash
pnpm add -D @zhin.js/testing
```

## Run setup

The fake uses the **real** `Scope`, `DisposeStack` and `GenerationHandoffStack`, plus the real owner-bound `databaseHostToken` / `scheduleHostToken` / `outboundHostToken` facades over in-memory process hosts.

```ts
import { runPluginSetup } from '@zhin.js/testing';
import plugin from '../plugin.js';

it('posts to the target group every 30 seconds', async () => {
  const fake = await runPluginSetup(plugin, { config: { target: 'g1' } });

  await fake.clock.advance(65_000);                     // advance the fake clock; due cron jobs run

  expect(fake.sent.map(call => call.kind)).toEqual(['send', 'send']);
  expect(fake.rows('notes')).toEqual([{ text: 'hello' }]); // table defined in setup
  await fake.dispose();                                  // runs lifecycle cleanups
});
```

### Config validation and defaults

When the plugin declares a `config` schema, `runPluginSetup` treats `config` the way the real runtime does. It validates the value against the schema, fills in defaults, and keeps only the top-level fields the schema declares. Invalid config throws `PluginConfigValidationError`, whose `issues` use the same wording as startup errors (for example `/limit must be >= 1`). So you can pass only what a user would write and assert that the defaults apply:

```ts
const fake = await runPluginSetup(plugin, { config: { target: 'g1' } });
expect(fake.config).toEqual({ target: 'g1', limit: 10 });      // limit comes from the schema default

await expect(runPluginSetup(plugin, { config: { limit: 0 } }))
  .rejects.toThrow(PluginConfigValidationError);               // missing target, limit out of range
```

- To get the resolved config without running `setup`, use `resolvePluginConfig(plugin, input)`.
- When the plugin declares no `config`, `config` is passed through unchanged.

::: warning Behaviour change (@zhin.js/testing 1.0.5)
Earlier versions of `runPluginSetup` passed `config` to `setup()` verbatim. If a test deliberately passes invalid or incomplete config, it now throws. Either complete the config, or opt out per test with `runPluginSetup(plugin, { config, validateConfig: false })`. `createFakePlugin` and `fake.setup()` are unchanged.
:::

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
import { createFakeMessage, createFakePlugin, fakeResource, runCommand, runMiddleware, runHandler } from '@zhin.js/testing';
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

## Run Agent tools

`runTool(fake, tool, input, options)` runs the default export of `tools/<name>/index.ts` the way the runtime's tool index does:

- If `inputSchema` is an executable schema (for example Zod), it parses the input first. JSON Schema inputs pass through unchanged, as they do in the runtime.
- If the tool declares `adapter`, you must pass a matching `client`.

`tool` can also be the local name of a tool registered through `addTool()` in `setup()`.

```ts
import { createFakeMessage, createFakePlugin, runTool } from '@zhin.js/testing';
import lookup from '../tools/lookup/index.js';

const fake = createFakePlugin({ config: { prefix: '> ' } });
const message = createFakeMessage({ id: 'm1', sender: { id: 'u1' },
  conversation: { endpoint: { id: 'bot', adapter: 'qq' }, kind: 'group', id: 'g1' } });

const result = await runTool(fake, lookup, { word: 'zhin' }, { message });
// inside the tool, context.origin = { kind: 'im', platform: 'qq', endpoint: 'bot', scope: 'group', sceneId: 'g1', messageId: 'm1' }
// context.principal = { subjectId: 'u1', roles: [] }
```

| Option | Effect |
| --- | --- |
| `message` | Derives `origin` (`kind: 'im'`) and `principal` from an inbound message, the same fake message your command tests use |
| `origin` / `principal` | Set explicitly; these take precedence over `message` |
| `policy` | Defaults to no permissions, attended, network disabled |
| `client` | Native client port `{ adapter, get() }`; required for tools bound to an `adapter` |
| `question` / `signal` / `traceId` / `turnId` / `sessionKey` | The matching context fields |

`createToolContext(fake, options)` only builds the context. `toolOriginFromMessage(message)` converts a message to the tool `origin` shape.

::: warning No model or approval
`runTool` skips model discovery, approval, permission and policy checks. It only exercises the tool's own logic.
:::

## Partial fakes: `fakeOf`

When a collaborator or event payload only needs a few members, use `fakeOf<T>({...})` instead of `{...} as never`. The cast lives in one place and call sites are still checked against `Partial<T>`:

```ts
const orchestrator = fakeOf<ActivityFeedbackOrchestrator>({ startPhase: vi.fn(), stopPhase: vi.fn() });
```

Prefer real or kit-provided fakes when they exist; keep `fakeOf` for narrow collaborators.

## Real runtime: `PluginTestKit`

The fake bypasses the renderer, outbound middleware and endpoint negotiation. To verify that a message really goes through that chain, use `PluginTestKit`: it mounts a disposable real test app and synthetic endpoints capture the final payload. See the kit [README](https://github.com/zhinjs/zhin/blob/main/packages/toolkit/testing/README.md) for usage and limits.

`kit.messageDiagnostics` is the same bounded, body-free reader the Console serves at `GET /api/messages/diagnostics`; use it to assert each message's route, dispatch status and delivery outcome.

## Official example

`plugins/services/activity-feedback/tests/activity-feedback-runtime.test.ts` has been migrated: `setup` runs through `createFakePlugin` with the event bus and hosts, payloads and the orchestrator use `fakeOf`, and the file no longer contains `as never`.

## Next

- [Host Token Reference](./host-tokens.md): the tokens the fake provides.
- [Complete Plugin Delivery](./plugin-delivery.md): test and release checklist.
- [Message Scenario Lab](./message-scenarios.md): preview authored expectations locally, then export and explicitly run a real regression in an independent fixture.
