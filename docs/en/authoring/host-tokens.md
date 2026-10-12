# Host Token Reference (Runtime API)

In the Plugin Runtime, plugins consume Host capabilities by token: `context.resources.use(token)` during setup, or `use(token)` inside command/tool execution. This page indexes common tokens; method surfaces are defined in the corresponding source packages.

## Messaging & Delivery

| Token | Yields | Key methods |
| --- | --- | --- |
| `outboundMessageToken` (`zhin.js/core/runtime` or `@zhin.js/core/runtime`) | `OutboundMessageService` | `send(request) → DeliveryReceipt` / `registerInteractiveHandler`; ingress handling and internal endpoint sending are outside this public contract |
| `outboundHostToken` (`zhin.js`) | `OutboundHost` | `send({ adapter, endpointKey, conversation, content })` — proactive outbound; `conversation` is `{ kind, id, parent?, threadId? }` |
| `runtimeEventPublisherToken` (`zhin.js`) | `RuntimeEventPublisher` | Broadcasts runtime events (source of inbox/Console message stream) |

## Persistence

| Token | Yields | Key methods |
| --- | --- | --- |
| `databaseHostToken` (`zhin.js`) | `PluginDatabaseHost` (tables isolated for every owner, including root) | `define(name, def)` / `models.get(name)` → `select / insert / update / delete / count`; `select()` requires explicit column names (`'*'` rejected) |
| `databaseRootHostToken` (`zhin.js`, root only) | `DatabaseHost` | Process-wide host for Console administration and custom composition roots |

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
