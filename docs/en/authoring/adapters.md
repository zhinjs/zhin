---
title: "Adapter Authoring"
description: "Write an adapter for a platform Zhin doesn't support yet: the minimal implementation, connecting and cleanup, sending and receiving, multiple accounts, and when you need the lower-level Endpoint"
---

# Adapter authoring

An adapter connects one chat platform to Zhin. **You only need this page if the platform you want has no official adapter yet**; supported platforms are listed under [Adapters](../adapters/index.md).

An adapter does three things:

1. creates the platform SDK client;
2. turns platform events into Zhin's unified messages;
3. turns outgoing Zhin messages into platform API calls.

Hot reload, account identity, version switching and resource cleanup are handled by the framework.

## Minimal implementation

Create `adapters/<platform>/index.ts` in your plugin and default-export `defineAdapter()`:

```ts
// adapters/example/index.ts
import { defineAdapter } from 'zhin.js/adapter';
import { ExampleClient } from 'example-sdk';

export default defineAdapter<{ readonly token: string }>({
  capabilities: ['inbound', 'outbound'],

  create(context) {
    const client = new ExampleClient(context.config.token);

    return {
      client,

      async connect({ events, signal, onCleanup }) {
        await client.login({ signal });
        onCleanup(() => client.logout());
        const unsubscribe = client.onMessage((message) => {
          void events.message({
            conversation: {
              kind: message.groupId ? 'group' : 'private',
              id: message.groupId ?? message.userId,
            },
            content: message.text,
            sender: { id: message.userId, name: message.nickname },
          });
        });
        onCleanup(unsubscribe);
      },

      send({ conversation, payload }) {
        return client.sendMessage(conversation.id, payload);
      },
    };
  },
});
```

Piece by piece:

| Part | Purpose |
| --- | --- |
| `capabilities` | Declares receiving (`inbound`), sending (`outbound`), or both — at least one. Live-stream danmaku platforms add `liveDanmaku` (requires `inbound`): the Agent then collects danmaku in a window and replies once per window (ADR 0038 §5, configured by `ai.agent.inboundQueue.live`) |
| `create(context)` | Called once per account; `context.config` is that account's config |
| `client` | The platform SDK instance. Commands get it as `context.$client`, event handlers as `event.client` |
| `connect()` | Connects to the platform and **returns only once it is usable** |
| `onCleanup(fn)` | Register cleanup right after acquiring each resource. If later setup fails, the framework rolls back in reverse order |
| `events.message()` | Reports an incoming message; the framework fills in the account identity |
| `send()` | Sends a message and returns the platform message id |

With a single cleanup action you can also just return it from `connect()`.

## Common tasks

### Receive this platform's messages in your bot

Mount the plugin containing the adapter on your bot and configure it in `zhin.config.yml`:

```yaml
configVersion: 2
plugins:
  example: '@example/adapter'
example:
  token: ${EXAMPLE_TOKEN}
```

After startup, check in Console's **Chat accounts** that the account is online and receiving. Mounting is covered in [First plugin · Mount it on your bot](../getting-started/first-plugin.md).

### Several accounts on one adapter

No code changes. Add an `endpoints` array in config; each entry creates a separate account connection, and `create(context)` receives the merged per-account config. Rules: [Endpoint lifecycle · Several accounts on one adapter](./endpoint-lifecycle.md#several-accounts-on-one-adapter).

### Listeners only the active version may hold

Some listeners or input streams may be held by only one version during a hot-reload switch. Implement a synchronous `activate({ events })` returning a release function; the framework calls it on switch and rollback. Ordinary SDK listeners belong in `connect()`.

### WebSocket / SSE, heartbeats and reconnection

Don't write your own reconnect state machine — use [`createEndpointLifecycle`](./endpoint-lifecycle.md).

### Platform-specific message formats

Convert platform-specific structures such as `share`, audio or cards at the `send()` boundary. Plugins still send through `Message.$reply` or `Adapter.sendMessage`; never open a separate send path.

### Manage accounts from chat

`createEndpointCommands` generates `<adapter> endpoint list / add / remove` commands; see [Commands · Endpoint management commands for adapters](./commands.md#endpoint-management-commands-for-adapters).

## When to extend Endpoint

`defineAdapter` as above covers most platforms. Only when a protocol needs a **custom multi-stage connection flow** should you extend the `Endpoint` class and implement `start` / `open` / `close` / `stop` yourself; see [Endpoint lifecycle hooks](./endpoint-lifecycle.md#endpoint-lifecycle-hooks).

## Reference implementations

- [`examples/minimal-bot/adapters/terminal/index.ts`](https://github.com/zhinjs/zhin/blob/main/examples/minimal-bot/adapters/terminal/index.ts): treats the terminal as a chat platform — good to study.
- [`plugins/adapters/napcat`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/napcat): WebSocket / HTTP connection modes using `createEndpointLifecycle`.

## Next steps

- [Endpoint lifecycle](./endpoint-lifecycle.md): long-lived connections, heartbeats, reconnection and multiple accounts.
- [Message flow](../concepts/message-flow.md): the full path of a message through the framework.
- [Complete plugin delivery](./plugin-delivery.md): test the adapter with the adapter harness and publish it.

## AI capabilities and scene guidance

The adapter owns platform capability declarations; the Agent should not maintain a second operation catalog:

- A Tool's `description`, `inputSchema`, `platforms / scopes / permissions` describe one operation.
- `agents/<platform>/skills/<name>/SKILL.md` groups operations by purpose and scene; instructions load on demand.
- `prompt-sections/<name>/index.ts` contains necessary shared conventions, restricted by `platforms` and `scopes`, without repeating the Skill/Tool catalog.
- `segments.supported` declares outbound types. `segments.model[type]` supplies extension fields, platform `hint` and optional `scopes`. A scene mismatch omits both its model schema and hint. This grants no send permission and does not change manually authored message delivery.

This example offers model-authored share cards only in groups; other scenes retain plain text and existing fallbacks. Declarations must match actual platform delivery, not assumptions based on names.

```ts
segments: {
  supported: ['text', 'share'],
  model: {
    share: {
      scopes: ['group'],
      hint: 'Use a real URL and title from the user or tool results.',
    },
  },
}
```

`text` always remains a common fallback; scene declarations on it restrict only its extra fields and hints.
