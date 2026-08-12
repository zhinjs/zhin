# Host Token Reference (Runtime API)

In the Plugin Runtime, plugins consume Host capabilities by token: `context.use(token)` during setup, or `use(token)` inside commands/tools at runtime. This page is the complete index; method surfaces are defined in the linked source packages.

## Messaging & Delivery

| Token | Yields | Key methods |
| --- | --- | --- |
| `messageGatewayToken` (`@zhin.js/core/runtime`) | `MessageGateway` | `receive` / `send(request) → DeliveryReceipt` / `sendEndpointMessage` / `onMessage` / `registerInteractiveHandler` |
| `outboundHostToken` (`@zhin.js/plugin-runtime`) | `OutboundHost` | `send({ adapter, endpointId, conversation, content })` — cross-platform outbound, addressed by ConversationRef |
| `runtimeEventPublisherToken` (`@zhin.js/plugin-runtime`) | `RuntimeEventPublisher` | Broadcasts runtime events (source of inbox/Console message stream) |

## Persistence

| Token | Yields | Key methods |
| --- | --- | --- |
| `databaseHostToken` (`@zhin.js/plugin-runtime`) | `PluginDatabaseHost` (tables isolated per owner) | `define(name, def)` / `models.get(name)` → `select / insert / update / delete / count`; `select()` requires explicit column names (`'*'` rejected) |
| `databaseRootHostToken` (`@zhin.js/plugin-runtime`, root only) | `DatabaseHost` | Process-wide host for Console administration and custom composition roots |

## Scheduling

| Token | Yields | Key methods |
| --- | --- | --- |
| `scheduleHostToken` (`@zhin.js/plugin-runtime`) | `PluginScheduleHost` (isolated per owner) | Register/cancel cron jobs; combine with `messageGatewayToken` for scheduled pushes |
| `scheduleRootHostToken` (`@zhin.js/plugin-runtime`, root only) | `ScheduleHost` | Process-wide schedule host |

## Agent

| Token | Yields | Key methods |
| --- | --- | --- |
| `agentHostToken` (`@zhin.js/agent`, `agent-host-port`) | Agent Host port | Access ZhinAgent / AI service (available when `@zhin.js/agent` is installed) |

## Rendering & HTTP

| Token | Yields | Key methods |
| --- | --- | --- |
| `htmlRendererToken` (`@zhin.js/plugin-runtime`) | `HtmlRendererHost` | `render(html, opts)` → png (requires `@zhin.js/html-renderer`; outbound html degrades to text otherwise) |
| `httpHostToken` (`@zhin.js/host-http`) | `HttpHost` | `route(method, path, handler, meta?)` — shared by Console/MCP/A2A/adapter webhooks |

## Example

```ts
export default definePlugin({
  name: 'reminder',
  setup({ use }) {
    const schedule = use(scheduleHostToken);
    const gateway = use(messageGatewayToken);
    schedule.register('0 9 * * *', async () => {
      await gateway.send({ conversation, requester, content: 'Good morning' });
    });
  },
});
```

Rules: call `use()` during setup; `use()` throws when the backing Host is not installed (e.g. `agentHostToken` without `@zhin.js/agent`). Scoped tokens (database/schedule) isolate data per plugin owner automatically; root-level process tokens are for the composition root (`basic/cli`) or explicit root scenarios only.

AI fallback is not a mutable `MessageGateway` plugin API. During generation setup,
the composition root provides the internal `ingressRouteToken` in root resources;
`ImRuntime.receive` resolves it only from the snapshot held by that message. Regular
plugins must not register or replace this token.
