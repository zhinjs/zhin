---
title: "Host Token Reference"
description: "Resources a plugin can take from the framework — proactive messaging, database and small-object state, schedules, Agent, HTML rendering, HTTP routes — and the rules for using them"
---

# Host Token reference

What the framework provides — sending messages, the database, schedules, HTTP routes… — reaches plugins as **tokens**. This page lists the common tokens, what they give you, and the rules for using them.

## How to use them

| Where | How |
| --- | --- |
| `setup` in `plugin.ts` | `context.resources.use(token)` |
| While a command, tool or schedule runs | `use(token)` on its execution argument |

```ts
// plugin.ts: send "Good morning" to a group every day at 9:00
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
    lifecycle.add(cancel); // cancel the old job on hot reload
  },
});
```

- `target` lives in this plugin's config. `adapter` is the instance path of a mounted adapter and `endpointKey` an account name configured in it — not an internal Capability ID. Config layout: [Plugin model](../concepts/plugin-model.md).
- Put **required** tokens in `requires` so startup refuses when they're missing; check **optional** ones with `resources.has(token)` first. Calling `use()` on a missing token throws (e.g. `agentHostToken` without `@zhin.js/agent` installed).
- Database, schedule and similar tokens are **isolated per plugin instance automatically**. Process-level tokens marked "root only" are for the composition root (`basic/cli`) or explicit root scenarios.

## Common tokens

### Sending messages

| Token | You get | Main methods |
| --- | --- | --- |
| `outboundHostToken` (`zhin.js`) | `OutboundHost` | `send({ adapter, endpointKey, conversation, content })` for proactive sends; `sendTarget(target, content)` sends precisely to a saved full target |
| `outboundMessageToken` (`zhin.js/core/runtime`) | `OutboundMessageService` | `send(request) → DeliveryReceipt`, `registerInteractiveHandler`; inbound handling and endpoint-internal sending aren't part of this public contract |
| `outboundRootHostToken` (`zhin.js`, root only) | `OutboundRootHost` | Process-level delivery port; the runtime binds a `PluginOutboundHost` for each plugin |
| `runtimeEventPublisherToken` (`zhin.js`) | `RuntimeEventPublisher` | Broadcast runtime events (the source of the inbox and Console message streams) |

### Storing data

| Token | You get | Main methods |
| --- | --- | --- |
| `databaseHostToken` (`zhin.js`) | `PluginDatabaseHost` (table names isolated per plugin, root included) | `define(name, def)` / `models.get(name)`; `select()` needs explicit column names (no `'*'`); `state` stores small JSON objects — see [below](#saving-small-objects-and-delivery-targets) |
| `databaseRootHostToken` (`zhin.js`, root only) | `DatabaseHost` | Process-level database host for the Console admin surface and custom composition roots |

### Schedules

| Token | You get | Main methods |
| --- | --- | --- |
| `scheduleHostToken` (`zhin.js`) | `PluginScheduleHost` (isolated per plugin, root included) | `register({ id, cron, execute })` returns a cancel function; `list()`. Six-field cron: sec min hour day month weekday |
| `scheduleRootHostToken` (`zhin.js`, root only) | `ScheduleHost` | Process-level schedule host |

### Agent

| Token | You get | Main methods |
| --- | --- | --- |
| `agentHostToken` (`@zhin.js/agent/runtime`) | Agent Host port | List Agent bindings, submit a `TurnRequest`, read Console / diagnostic projections; doesn't expose ZhinAgent / AIService instances |
| `workroomHostToken` (`@zhin.js/workroom`) | Workroom Host port | Published by the CLI composition root together with `agentHostToken`; its `console` holds only the Workroom control ports (run control, catalog, profiles / knowledge / sponsor / data lifecycle). For the Console / host-http, not for plugins to inject; the Console view is the key-disjoint merge of the two consoles |
| `turnIntentResolverToken` (`@zhin.js/agent/runtime`) | A trusted intent resolver provided by the account's owning plugin | Resolves a message to `supersede`, `new`, `steer`, `follow_up` or `observe` by platform / scene; only it may issue `authorizedBy: 'product_policy'` for cross-participant control |
| `aiCompletionToken` (`zhin.js`; `zhin.js/agent` / `@zhin.js/agent/runtime` re-export the same token) | `AiCompletion` (optional: present only when AI is configured, see [below](#plain-text-ai-completion)) | `completeText({ purpose, system?, prompt, untrusted?, agent?, model?, maxTokens?, timeoutMs?, signal?, onBehalfOf?, usageShares? })` runs one plain text completion with **no tools at all**, with retry, timeout and same-provider model fallback. Content in `untrusted` (group chat and the like) is rendered as data, so instructions inside it have no effect. With `onBehalfOf` (type `UsageSubject`: `{ userId, groupId?, owner }`; in group / channel chats `groupId` is `${platform}:${endpoint}:${sceneId}`), the call counts against that user's / group's usage quota (`AiCompletionQuotaError` when over). Use it when a plugin only needs text instead of borrowing a whole Agent turn |

### Rendering and HTTP

| Token | You get | Main methods |
| --- | --- | --- |
| `htmlRendererToken` (`zhin.js`) | `HtmlRendererHost` | `render(html, opts)` → PNG; requires `@zhin.js/html-renderer`, otherwise outbound HTML falls back to text |
| `httpHostToken` (`@zhin.js/host-http`) | `HttpHost` | `route(method, path, handler, meta?)` registers HTTP routes (shared by Console, MCP, A2A and adapter webhooks) |

## Plain text AI completion

`aiCompletionToken` and its types are imported from the `zhin.js` main entry, so a plugin does not need to depend on `@zhin.js/agent`. The runtime provides the resource only when AI (`@zhin.js/agent`) is installed and configured, so check before calling `use()`:

```ts
import { defineCommand } from 'zhin.js/command';
import { aiCompletionToken, hasResource, isAiCompletionQuotaError, usageSubjectFromMessage } from 'zhin.js';

export default defineCommand({
  execute: async (context) => {
    if (!hasResource(context, aiCompletionToken)) return 'AI is not configured, cannot summarize';
    const onBehalfOf = context.input ? usageSubjectFromMessage(context.input) : undefined;
    try {
      const { text } = await context.use(aiCompletionToken).completeText({
        purpose: 'summarize-chat',
        system: 'Summarize the chat below in three sentences.',
        prompt: 'Please summarize.',
        untrusted: [{ source: 'group-chat', text: context.args.join(' ') }],
        onBehalfOf,
      });
      return text;
    } catch (error) {
      if (isAiCompletionQuotaError(error)) return error.message;
      throw error;
    }
  },
});
```

| Export (`zhin.js`) | What it does |
| --- | --- |
| `hasResource(context, token)` | `true` when `context.use(token)` would succeed, without throwing. Uses the context's `has()` and falls back to probing `use()` when it is missing |
| `context.has?.(token)` | Built-in construction / capability contexts (commands, tools, middleware, `@zhin.js/testing` fake plugins) all provide `has()`. It is an optional member, so hand-written contexts do not have to implement it |
| `usageSubjectFromMessage(message)` | Builds `onBehalfOf` with the same rules as Agent turns: platform prefers `clientAdapter`, endpoint prefers `endpointId`, `groupId` is `${platform}:${endpoint}:${sceneId}` in group / channel chats, and `owner` is `true` when the sender has the `master` role. **Returns `undefined` when the message has no sender** (it does not throw); the call then counts against nobody's quota |
| `isAiCompletionQuotaError(error)` | Recognises the over-quota error (`scope` is `user` or `group`, `retryAfterSeconds` is the suggested wait). Its `message` can be replied to the user as is. No `@zhin.js/agent` import needed |

::: tip Relation to the Agent package
`zhin.js/agent` and `@zhin.js/agent` still export `aiCompletionToken`. It is the same object as the one from `zhin.js`, so existing code keeps working. The `AiCompletionQuotaError` class stays in the Agent package; plugins can check for it with `isAiCompletionQuotaError`.

Before sharing a completion, check that the service declares `supportsUsageShares === true`. Older services may ignore unknown fields; keep separate `onBehalfOf` calls for those services instead of silently losing attribution. For a shared completion, pass `usageShares: [{ subject, text }]` instead of `onBehalfOf`; the two are mutually exclusive. Each participant's original `text` supplies the estimated token weight used to split the prompt reservation and positive settlement delta. A shared request consumes one rate slot per group. User quota failures throw `AiCompletionQuotaError` with `deniedUserIds` before provider dispatch or quota reservation. Remove those participants' review items and rebuild both the prompt and usageShares before resubmitting; removing attribution alone must not leave their messages under review. A group quota failure stops that group's request. Existing single-user calls and failed-request reservation semantics remain compatible.
:::

## Saving small objects and delivery targets

Many plugins need to remember "which group, for whom". `createDeliveryTarget(message)` copies the incoming message's conversation address into a serializable object, and `database.state` stores small objects like it:

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
  await state.set('recent', { text: 'remind me' }, { ttlMs: 60_000 });
}

async function deliver(stateTarget: DeliveryTarget, use: UseAccessor) {
  const outbound = use(outboundHostToken);
  if (!outbound.sendTarget) throw new Error('This Host does not support full-target delivery');
  await outbound.sendTarget(stateTarget, 'Reminder!');
}
```

| Method | Purpose |
| --- | --- |
| `state.get<T>(key)` | Read; returns an independent JSON copy or `undefined` |
| `state.set(key, value, { ttlMs? })` | Overwrite; `ttlMs` is a lifetime in milliseconds, omitted means permanent |
| `state.update(key, fn)` | Atomic update; re-reads and retries on concurrent conflicts |
| `state.delete(key)` | Delete |
| `state.forUser(endpoint, senderId)` | A sub-space isolated by account + user |
| `state.forConversation(target)` | A sub-space isolated by full conversation address (incl. parent channel and thread) |

::: warning update callbacks must be pure
An `update` callback may run several times (up to 64 retries, then it errors under sustained contention), so it must not send messages, call the network or have other side effects.
:::

::: details More rules
- **Targets**: `createDeliveryTarget` copies the public `message.conversation` — exact account ID, adapter, conversation kind and ID, parent channel and thread. It holds no Message, client or old-version reference. Don't replace IDs with names or platform display names yourself.
- **Delivery**: goes through the current execution's runtime and the unified rendering / outbound middleware chain. The sending plugin's identity is injected by `PluginOutboundHost`; the adapter in the target is used only for addressing, so the sender's components and resources never switch to the adapter plugin's. A deleted target account or identity mismatch is refused explicitly — it never redirects to a bot with the same name. Delivery errors keep `EndpointDeliveryError.disposition` (`rejected`, `not_sent`, `unknown`); **never blindly retry `unknown`**.
- **Isolation**: `state` is isolated per plugin instance by default; `forUser` / `forConversation` narrow it further.
- **Size and types**: a value must be under 64 KiB of UTF-8 JSON; functions, Date, NaN, sparse arrays, getters, hidden properties and cycles are rejected. It's for small objects, not a replacement for business tables that need queries, indexes or batch transactions.
- **TTL**: measured from the write attempt; after expiry `get` and `update` treat the key as absent; an update replaces the previous TTL.
- **Database support**: atomic state supports SQLite, MySQL and PostgreSQL over the same database connection. Missing persistence, a disconnected database, or MongoDB / Redis report an explicit error rather than falling back to memory; other dialects' existing `models` API is unaffected.
- **Hot reload**: don't keep a Store across hot reloads. Operations already started finish; new operations on an old version's Store are refused — `use(databaseHostToken)` again in the current execution context.
- **Tests**: `basic/cli/tests/plugin-runtime/persistent-state-runtime.test.ts` uses the real runtime to verify isolation, hot reload and recovery after process restart for the reminder (conversation state and saved targets) and preferences (user state) plugins; `persistent-state.test.ts` covers concurrency, isolation by user / account / parent channel / thread, and TTL; `persistent-state.live.test.ts` verifies atomic updates on real MySQL / PostgreSQL. The synthetic send fixtures are not real platform delivery acceptance.
:::

## Internal tokens

The AI fallback reply is not a plugin-modifiable API. The composition root provides an internal `ingressRouteToken` to root resources at startup, and `ImRuntime.receive` reads it only from the snapshot the current message holds. Regular plugins must not register or replace it.

## Next steps

- [definePlugin](./define-plugin.md): full examples of using these resources in `setup`.
- [Module-level state](./module-state.md): turn your own services into tokens.
