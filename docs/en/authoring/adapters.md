# Adapter authoring

A platform adapter has three jobs: create the platform client, translate platform events into Zhin events, and translate outbound Zhin requests into platform calls. The framework owns hot reload, Endpoint identity, generation admission, and cleanup.

Create a TypeScript file under the plugin or project's `adapters/` directory and default-export `defineAdapter()`:

```ts
import { defineAdapter } from 'zhin.js/adapter';
import { ExampleClient } from 'example-sdk';

export default defineAdapter({
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

`client` is the platform SDK object exposed as `$client` in commands and handlers. `connect()` resolves when the platform is ready. Register each acquired resource with `onCleanup()` immediately; the framework unwinds them in reverse order if later setup fails. For one cleanup action, returning it from `connect()` remains a shorthand. `events.message()` attaches the current Endpoint identity automatically. `send()` returns the platform message id.

Implement synchronous `activate({ events })` when a listener or input stream must belong only to the active generation; return its release function. Ordinary SDK listeners belong in `connect()`.

Only protocols that need custom multi-stage connection behavior should extend `Endpoint`. Use [`createEndpointLifecycle`](./endpoint-lifecycle.md) for WebSocket, SSE, heartbeat, and reconnect behavior. Translate platform-specific share, audio, and card structures at the `send()` protocol boundary.

See [`examples/minimal-bot/adapters/terminal.ts`](../../../examples/minimal-bot/adapters/terminal.ts) for a runnable implementation.
