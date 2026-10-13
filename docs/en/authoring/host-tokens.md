# Host Token Reference (Runtime API)

In the Plugin Runtime, plugins consume Host capabilities by token: `context.resources.use(token)` during setup, or `use(token)` inside command/tool execution. This page indexes common tokens; method surfaces are defined in the corresponding source packages.

## Messaging & Delivery

| Token | Yields | Key methods |
| --- | --- | --- |
| `outboundMessageToken` (`zhin.js/core/runtime` or `@zhin.js/core/runtime`) | `OutboundMessageService` | `send(request) → DeliveryReceipt` / `registerInteractiveHandler`; ingress handling and internal endpoint sending are outside this public contract |
| `outboundHostToken` (`zhin.js`) | `OutboundHost` | `send({ adapter, endpointKey, conversation, content })` — proactive outbound; `sendTarget(target, content)` sends to an exact persisted destination |
| `outboundRootHostToken` (`zhin.js`, root only) | `OutboundRootHost` | Process-wide delivery port; Runtime binds a `PluginOutboundHost` to each plugin |
| `runtimeEventPublisherToken` (`zhin.js`) | `RuntimeEventPublisher` | Broadcasts runtime events (source of inbox/Console message stream) |

## Persistence

| Token | Yields | Key methods |
| --- | --- | --- |
| `databaseHostToken` (`zhin.js`) | `PluginDatabaseHost` (tables isolated for every owner, including root) | `define(name, def)` / `models.get(name)`; `state` stores small JSON values with TTL and atomic updates; `select()` requires explicit column names (`'*'` rejected) |
| `databaseRootHostToken` (`zhin.js`, root only) | `DatabaseHost` | Process-wide host for Console administration and custom composition roots |

### Durable destinations and small-object state

`createDeliveryTarget(message)` copies the public `message.conversation`: exact Endpoint ID, Adapter owner, conversation kind/ID, parent and thread. The result can be JSON serialized or stored directly in `database.state`; it retains no Message, client or generation. Do not replace these identities with endpoint names or platform display names.

```ts
import {
  createDeliveryTarget, databaseHostToken, outboundHostToken,
  type DeliveryTarget, type Message, type UseAccessor,
} from 'zhin.js';

async function remember(message: Message, use: UseAccessor) {
  const target = createDeliveryTarget(message);
  const state = use(databaseHostToken).state.forConversation(target);
  await state.set('target', target);
  await state.update<number>('count', (current) => (current ?? 0) + 1);
  await state.set('recent', { text: 'Remind me' }, { ttlMs: 60_000 });
}

async function deliver(stateTarget: DeliveryTarget, use: UseAccessor) {
  const outbound = use(outboundHostToken);
  if (!outbound.sendTarget) throw new Error('This Host does not support durable destinations');
  await outbound.sendTarget(stateTarget, 'Your reminder');
}
```

Delivery uses the Runtime from the current operation and the shared rendering/outbound middleware pipeline. `PluginOutboundHost` supplies the sending plugin's owner; the destination Adapter owner only identifies the endpoint. Rendering therefore uses the sending plugin's components and resources. Missing endpoints or mismatched owners reject without redirecting to another bot with a matching name. Delivery errors preserve `EndpointDeliveryError.disposition`: `rejected`, `not_sent`, or `unknown`. Do not blindly retry an unknown delivery.

`use(databaseHostToken).state` isolates values by plugin instance owner. `forUser(endpoint, senderId)` adds exact endpoint/user isolation; `forConversation(target)` adds the complete conversation address, including parent and thread. `get<T>(key)` returns a detached JSON copy or `undefined`; `set` replaces and `delete` removes. `update` compares database revisions atomically and rereads/retries after cross-connection contention. Its updater must be a synchronous pure function: no message sending, network calls or other side effects. Sustained contention fails explicitly after 64 attempts.

TTL is in milliseconds from the write attempt; expired values are absent for both `get` and `update`. Omitting `ttlMs` stores persistently, replacing the previous TTL. Values must be smaller than 64 KiB of UTF-8 JSON. Functions, Dates, NaN, sparse arrays, getters, hidden properties and cycles are rejected. Use business tables for queries, indexes or multi-row transactions.

The CLI implements atomic state for SQLite, MySQL and PostgreSQL on the existing DatabaseHost and database service. Missing persistence, disconnected databases, MongoDB and Redis fail explicitly without an in-memory persistence fallback; other dialects' existing model APIs are unchanged. Do not retain a Store across hot reload: an operation that already started holds a lease and completes, while new operations on a retired generation's Store reject. Resolve it again with `use(databaseHostToken)` in the current execution context.

`basic/cli/tests/plugin-runtime/persistent-state-runtime.test.ts` discovers two actual Runtime plugins and their named commands: reminder uses conversation state/durable targets, while preferences uses user state. It verifies owner isolation, hot reload and restoration after rebuilding the process runtime. `persistent-state.test.ts` covers independent connections, users/endpoints/parents/threads and TTL; `persistent-state.live.test.ts` verifies CAS against independent MySQL/PostgreSQL services. Synthetic outbound fixtures do not prove real IM platform delivery.

## Scheduling

| Token | Yields | Key methods |
| --- | --- | --- |
| `scheduleHostToken` (`zhin.js`) | `PluginScheduleHost` (isolated for every owner, including root) | `register({ id, cron, execute })` returns a cancel function / `list()`; cron has six fields (second, minute, hour, day, month, weekday) |
| `scheduleRootHostToken` (`zhin.js`, root only) | `ScheduleHost` | Process-wide schedule host |

## Agent

| Token | Yields | Key methods |
| --- | --- | --- |
| `agentHostToken` (`@zhin.js/agent/runtime`) | Agent Host port | Enumerate Agent bindings, submit canonical `TurnRequest`s, and read Console/diagnostic projections; concrete ZhinAgent / AIService instances are not exposed |
| `turnIntentResolverToken` (`@zhin.js/agent/runtime`) | Trusted intent resolver provided by the endpoint owner | Resolve messages by adapter/scene to `supersede`, `new`, `steer`, `follow_up`, or `observe`; only this resolver may issue `authorizedBy: 'product_policy'` for cross-participant control |

## Rendering & HTTP

| Token | Yields | Key methods |
| --- | --- | --- |
| `htmlRendererToken` (`zhin.js`) | `HtmlRendererHost` | `render(html, opts)` → png (requires `@zhin.js/html-renderer`; outbound html degrades to text otherwise) |
| `httpHostToken` (`@zhin.js/host-http`) | `HttpHost` | `route(method, path, handler, meta?)` — shared by Console/MCP/A2A/adapter webhooks |

## Example

```ts
import { definePlugin, outboundHostToken, scheduleHostToken } from 'zhin.js';

interface ReminderConfig {
  target: {
    adapter: string;
    endpointKey: string;
    conversation: { kind: 'private' | 'group' | 'channel'; id: string };
  };
}

export default definePlugin<ReminderConfig>({
  name: 'reminder',
  requires: [scheduleHostToken, outboundHostToken],
  setup({ resources, config, lifecycle }) {
    const schedule = resources.use(scheduleHostToken);
    const outbound = resources.use(outboundHostToken);
    const target = config.get().target;
    const cancel = schedule.register({
      id: 'morning',
      cron: '0 0 9 * * *',
      async execute() {
        await outbound.send({ ...target, content: 'Good morning' });
      },
    });
    lifecycle.add(cancel);
  },
});
```

Place `target` in this plugin's configuration node. `adapter` is the mounted Adapter instance path, and `endpointKey` is the configured Endpoint name within that instance; do not substitute an internal Capability ID. See [Plugin model](../concepts/plugin-model.md) for configuration layers. Add the cancel function to `lifecycle` so hot reload does not leave an old job running.

Rules: use `resources.use()` in setup and the context's `use()` during command/tool execution. Missing Host tokens throw (e.g. `agentHostToken` without `@zhin.js/agent`). Declare required Hosts with `requires`; check optional Hosts with `resources.has(token)` first. Scoped tokens (database/schedule) isolate data per plugin owner automatically; root-level process tokens are for the composition root (`basic/cli`) or explicit root scenarios only.

AI fallback is not a mutable `OutboundMessageService` plugin API. During generation setup,
the composition root provides the internal `ingressRouteToken` in root resources;
`ImRuntime.receive` resolves it only from the snapshot held by that message. Regular
plugins must not register or replace this token.
