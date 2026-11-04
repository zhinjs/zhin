---
title: "Adapter Authoring"
description: "Write an adapter for a platform Zhin doesn't support yet: the minimal implementation, connecting and cleanup, sending and receiving, multiple accounts, native Client ownership and framework hooks"
---

# Adapter authoring

An adapter connects one chat platform to Zhin. **You only need this page if the platform you want has no official adapter yet**; supported platforms are listed under [Adapters](../adapters/index.md).

An adapter does three things:

1. creates the platform SDK client;
2. turns platform events into Zhin's unified messages;
3. turns outgoing Zhin messages into platform API calls.

Hot reload, account identity, version switching and resource cleanup are handled by the framework.

## Adapter API 2 version boundary

This batch uses npm patch versions but intentionally changes plugin interfaces. Its first target
versions are `zhin.js 1.1.19`, `@zhin.js/core 1.1.54`, `@zhin.js/adapter 1.1.26` and
`@zhin.js/feature-kit 1.1.10` (verify the formal release inventory before installation).
Old interfaces are supported only before these floors. New plugins need those npm peer/dev
minimums and an explicit Adapter Feature requirement:

```json
{ "features": [{ "package": "@zhin.js/adapter", "api": "^2.0.0" }] }
```

This `api` belongs to `package.json#zhin.features`; it is separate from npm versions and
`zhin.engine`. The initial cutover declared `featureApi: 2.0.0` (self-profile support adds `2.1.0`): explicit API-1 consumers are refused,
and API-2 consumers are refused on an API-1 provider. Omitted API metadata keeps its existing
behavior and does not certify compatibility. Recompile custom plugins, update peer/dev floors
and verify the installed stack; see [version compatibility and migration](../operations/upgrades.md#adapter-api-2).

## Minimal implementation

Create `adapters/<platform>/index.ts` in your plugin and default-export `defineAdapter()`:

```ts
// adapters/terminal/index.ts
import { Adapter, defineAdapter } from 'zhin.js/adapter';
import { TerminalEndpoint } from './endpoint.js';

interface TerminalConfig {
  readonly terminal?: { readonly interactive?: boolean; readonly prompt?: string };
}

class TerminalAdapter extends Adapter<TerminalEndpoint, TerminalConfig, { readonly line: string }> {
  protected createEndpoint(config: TerminalConfig): TerminalEndpoint {
    return new TerminalEndpoint({
      input: process.stdin, output: process.stdout, error: process.stderr,
      interactive: config.terminal?.interactive ?? true,
      prompt: config.terminal?.prompt ?? 'zhin> ',
    });
  }
}

declare module '@zhin.js/feature-kit' {
  interface AdapterRegistry { readonly terminal: TerminalAdapter; }
}

export default defineAdapter<TerminalConfig>({
  capabilities: ['inbound', 'outbound'],
  createAdapter: () => new TerminalAdapter(),
});
```

The adapter package must declare a direct `@zhin.js/feature-kit` dependency. Custom published plugins can use peer plus development dependencies; official adapters use exact internal dependencies. Augment only that module; `zhin.js/adapter` still exports the Adapter APIs but is not a registry registration entry. Business commands need only the literal adapter name once the package declarations are loaded.

`TerminalEndpoint` extends the `TerminalClient` that owns terminal IO and `implements Endpoint`; see the complete [terminal example](https://github.com/zhinjs/zhin/blob/main/examples/minimal-bot/adapters/terminal/index.ts). When a platform has an SDK, extend its real Client. Without an SDK, the Client must own protocol IO, requests and cancellation, rather than call back into the Endpoint to find its implementation.

| Part | Responsibility |
| --- | --- |
| `capabilities` | Declare inbound, outbound or both; `liveDanmaku` also requires `inbound` |
| `createAdapter(context)` | Construct the plugin-owned Adapter with configuration and injected dependencies |
| `Adapter.createEndpoint(config, execution)` | Construct the real Endpoint only when its account starts; execution fixes canonical identity, instance and cancellation |
| `Endpoint` | A structural interface, with no public framework base class |
| `[endpointSpec]` | Attach framework hooks with `createEndpointSpecification(this, hooks)` without overriding SDK APIs |
| `events.message()` | Publish normalized messages with framework-supplied account identity; sender identity must come from a real user |
| specification `send()` | Encode and send messages, returning confirmed ids or ordered `{ parts }` evidence |

## Common tasks

### Receive this platform's messages in your bot

Mount the plugin containing the adapter on your bot and configure it in `zhin.config.yml`:

```yaml
configVersion: 2
plugins:
  terminal: '@example/adapter-terminal'
terminal:
  terminal:
    interactive: true
```

After startup, check in Console's **Chat accounts** that the account is online and receiving. Mounting is covered in [First plugin · Mount it on your bot](../getting-started/first-plugin.md).

### Several accounts on one adapter

No code changes. Add an `endpoints` array in config; each entry creates a separate account connection, and the owning Adapter’s `createEndpoint(config, execution)` receives the merged per-account config. Rules: [Endpoint lifecycle · Several accounts on one adapter](./endpoint-lifecycle.md#several-accounts-on-one-adapter).

### Only the current version owns a listener

Subscribe exclusive listeners in the specification’s `open` hook, unsubscribe in `close`, and release IO in `stop`. Do not add a global live Endpoint Map. Track each complete accepted callback with `events.run`, as described below.

### WebSocket / SSE, heartbeats and reconnection

Don't write your own reconnect state machine — use [`createEndpointLifecycle`](./endpoint-lifecycle.md).

### Platform-specific message formats

Convert platform-specific structures such as `share`, audio or cards at the `send()` boundary. Plugins still send through `Message.$reply` or the Host’s `outboundHostToken`; never open a separate send path.

### Manage accounts from chat

`createEndpointCommands` generates `<adapter> endpoint list / add / remove` commands; see [Commands · Endpoint management commands for adapters](./commands.md#endpoint-management-commands-for-adapters).

## Native Client inheritance and account ownership

Implement `Adapter<E, Config, Events>` and let it own every Endpoint. An Endpoint extends the actual SDK Client and uses `endpointSpec` / `createEndpointSpecification` for framework hooks without replacing native `on`, `off`, or `emit`. Register the Adapter type once through the canonical `@zhin.js/feature-kit` `AdapterRegistry`; literal platform declarations in commands infer its Endpoint.

Adding an account saves disabled configuration without constructing an SDK object. Explicit start connects it. The owning Adapter handles update, stop, removal, and replacement. Updating only configured `nickname` / `profile` preserves the connection; connection changes reconnect only that account, and existing operations remain bound to their original incarnation. `defineAdapter` accepts only `createAdapter`; do not add another global account controller, Client token, or writable Endpoint directory.

### Updating configured profile fallbacks

`nickname` / `profile` provide fallbacks when platform facts are unavailable; they do not instruct the platform to change the real account. Account fields override inherited Adapter defaults, while observed platform facts still take precedence. Updating defaults does not write account records, overwrite explicit values, or call an SDK profile mutation. File startup seeds cannot replace existing managed desired records.

If `setup` does not use these fields to construct business state, the plugin can explicitly declare them as Feature-owned:

```ts
import { definePlugin } from 'zhin.js';

export default definePlugin({
  name: 'example-adapter',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  setup(context) {
    // Initialize resources that do not depend on these profile fields.
  },
});
```

This declaration does not make every `endpoints` edit safe in place. The Adapter checks the actual differences and accepts only profile changes; account membership, identity and connection edits keep their lifecycle rules. Other Features in the same plugin rebuild their projections with the new snapshot configuration; returning an old index is insufficient. Third-party plugins without this declaration keep their existing reload behavior.

Admitted operations retain their original fallback facade, while new operations use the new configuration view. Platform observations and transport remain owned by the same account. Do not change shared defaults during asynchronous `activateNext`, and do not treat a captured setup `context.config.get()` as a global getter that updates automatically. Commands, tools and handlers should read the configuration attached to their own operation. If setup must capture profile fields, omit this declaration.

SDK `emit/on/off` and native methods retain their own contracts. Register the actual Adapter once in `AdapterRegistry`; its `Adapter<Endpoint, Config, Events>` parameters infer Client and EventMap through that same registry, without another Client descriptor or token.

The adapter declarations must belong to the TypeScript project. Local convention directories are included normally; across packages, load the adapter through `compilerOptions.types` or a single package import. Each command then needs only `adapter: 'icqq'`, without importing a concrete Adapter class. Runtime plugin loading does not modify the editor's type project.

## Admit the complete SDK callback

Wrap the whole asynchronous SDK listener in `events.run(async () => { ... })`, including decoding, native-event forwarding and normalized message submission. Await or handle its Promise. Wrapping only the final `events.message()` leaves earlier asynchronous decoding outside the receipt lifetime.

`close` first closes new framework admission, calls the platform close hook, then drains already accepted callbacks and their normalized continuations. `stop` retires that incarnation and cancels its signal before draining operation leases and releasing resources. Platform requests must honor this signal. Do not wait for an account’s own `close/stop` inside its inbound callback: that would wait on itself and is rejected.

A native event means the SDK’s public event and the object it actually supplies. Preserve that payload and its fields rather than reconstructing it from a normalized message. It is not necessarily a raw wire packet: do not claim preservation of encrypted frames, HTTP bytes or SDK internals that the SDK never exposes. For platform-parsed XML webhooks or ParsedMail, preserve the actual original object on the native-event path too.

`events.message()` publishes normalized messages; `events.platform(name, event)` preserves native events. Use `events.emitAccepted()` when a cursor or ACK must wait for real admission and dispatch; failed dispatch must not advance that cursor. Continue using `createEndpointLifecycle` for reconnect and heartbeat; see [lifecycle hooks](./endpoint-lifecycle.md#endpoint-lifecycle-hooks).

## Capability profile

Core recognizes capabilities, not platform names: an adapter declares what its platform can do with `defineAdapter({ profile })`, zhin merges and narrows it into `TurnCapabilities` for every turn, and agents and plugins read that instead of branching on a platform name (ADR 0044).

A profile has sections per conversation kind: `default`, `private`, `group`, `channel`, `thread` (and `kinds` for adapter-declared kinds). Fields you leave out inherit from `default`; writing `false` in a kind section switches an inherited capability off. Each section has seven groups:

| Group | Content |
|---|---|
| `messaging` | `segments` (the former `AdapterDefinition.segments`; both name the same declaration, write it once), `maxLength`, `mention`, `quote`, `reaction`, `recall`, `edit`, `forward`, `maxMessagesPerTurn` |
| `scene` | `groupInfo`, `memberProfile`, `roles` (platform role words to `owner / admin / member`), `mute`, `maxMembers`, `card`, `title` |
| `actions` | What the Bot can do: `reaction`, `poke`, `mute`, `unmute`, `muteAll`, `kick`, `setCard`, `setTitle`, `recall`, `essence`, `announce`, `invite`, `quoteReply`, `forward`; each `{ scopes, requiresRole?, params? }`, absent means unsupported |
| `events` | `emit` (standard event names), `liveDanmaku` (the former `capabilities: ['liveDanmaku']`) |
| `feedback` | How "typing" is shown: `typing` / `reaction` / `status-message` / `none` |
| `delivery` | `send`, `proactive`, `passiveWindow`, `rateLimitPerMinute`, `mediaMaxBytes`, `spool`, `requiresMessageSeq` |
| `prompt` | `auto` (generate the platform description), `text` (adapter-authored text) |

An icqq-like example:

```ts
import { defineAdapter } from 'zhin.js/adapter';

export default defineAdapter({
  capabilities: ['inbound', 'outbound'],
  profile: {
    default: {
      messaging: { maxLength: 4500, quote: true, segments: { supported: ['text', 'image', 'mention', 'face'] } },
      scene: { roles: { owner: 'owner', admin: 'admin', member: 'member' } },
      actions: {
        reaction: { scopes: ['group'], params: { emojis: ['76', '66', '63'] } },
        poke: { scopes: ['private', 'group'], params: { minIntervalSeconds: 5 } },
        recall: { scopes: ['private', 'group'], params: { timeLimitSeconds: 120 } },
      },
      feedback: { mode: 'reaction', emoji: '424' },
      delivery: { send: true, proactive: true, spool: true },
    },
    group: {
      scene: { groupInfo: true, memberProfile: true, card: true, title: true, mute: { all: true } },
      actions: {
        mute: { scopes: ['group'], requiresRole: 'admin', params: { durationSeconds: { min: 60, max: 2592000 } } },
        kick: { scopes: ['group'], requiresRole: 'admin' },
        essence: { scopes: ['group'], requiresRole: 'admin' },
        announce: { scopes: ['group'], requiresRole: 'admin', params: { maxLength: 1000 } },
        setTitle: { scopes: ['group'], requiresRole: 'owner' },
      },
      prompt: { text: 'Reply in groups only when addressed; do not flood the chat.' },
    },
    private: {
      actions: { poke: { scopes: ['private'] } },
      scene: { groupInfo: false },
    },
  },
  // Optional: narrow by trusted facts. It may only switch capabilities off or shrink ranges;
  // widening fields are dropped with a logged warning.
  resolveCapabilities({ facts }) {
    return facts.conversation?.muteAll ? { actions: { poke: false } } : undefined;
  },
  create: () => myEndpoint(),
});
```

Rules:

- **Not declared means unsupported.** The profile is validated in `defineAdapter`; unknown fields and wrong types throw.
- **A declared action needs its port.** Every action maps to an existing port method (`reaction` -> `control.addReaction`, `recall` -> `control.recall`, `mute` -> `management.muteGroupMember`, `kick` -> `management.kickGroupMember`, `announce` -> `management.sendGroupNotice`, `poke` -> `management.pokeUser`, `unmute` -> `management.unmuteGroupMember`, `muteAll` -> `management.muteAllGroupMembers`, `setCard` -> `management.setGroupCard`, `setTitle` -> `management.setGroupTitle`, `essence` -> `management.setGroupEssence`, `invite` -> `management.inviteGroupMember`, `quoteReply` / `forward` -> `send()`). A missing port fails at assembly and names the method. With a profile, the `recall / edit / reaction / typing` entries of `operations` are implied by the profile, so you need not repeat them.
- **Narrow only.** Per turn zhin merges `default` with the conversation's kind section, applies generic narrowing (actions off when the Bot's platform role does not satisfy `requiresRole`, or is unknown; sending and message-sending actions off while the Bot is muted; sending off once the passive reply window is used up), then applies the `resolveCapabilities` patch.
- **No profile still works.** An adapter without `profile` gets a conservative one derived from `capabilities`, `operations` and `segments` (it can send, plus declared recall/edit/reaction/typing and the existing segment policy); everything else is unsupported.
- Read it in a turn: `turn.input.platformCapabilities?.has('actions.mute')`, `.get('actions.mute.durationSeconds')` (an action's `params` can be omitted from the path). Capabilities say what the platform allows; who may make the Bot do it is still decided by roles, hard gates and approvals.

## Official adapter capability matrix

A check mark means the profile declares it and the port is implemented; a blank cell means undeclared, i.e. unsupported. Only icqq implements the management actions in full; napcat only has group announcements.

| Adapter | Recall | Quote reply | Edit | Reaction | Poke / mute / kick / card / title / essence / invite | Announce | Feedback | Other |
|---|---|---|---|---|---|---|---|---|
| icqq | ✓ (2 min) | ✓ | | ✓ (group) | ✓ (management needs the Bot to be admin/owner, title needs owner) | ✓ | group: reaction; private: status message | forward, events, scene facts |
| qq (official) | ✓ | ✓ | | | | | | passive reply window: group 5 min x 5, C2C 60 min x 4, channel 5 min x 5 |
| napcat | ✓ | ✓ | | | | ✓ (admin) | | |
| onebot11 / onebot12 / milky | ✓ | ✓ | | | | | | |
| kook / telegram / lark / discord | ✓ | ✓ | | | | | | discord reactions stay in `operations` (the interactions transport cannot react); telegram recall within 48 h |
| slack | ✓ | | ✓ | ✓ (cancellable) | | | | |
| satori / wecom | ✓ | | | | | | | |
| weixin-ilink | | | | | | | typing | |
| wechat-mp | | | | | | | | customer-service window 48 h |
| bilibili / bilibili-live | | | | | | | | 1000-char comments / 20-char danmaku; bilibili-live declares liveDanmaku |
| dingtalk / line / email / github / sandbox | | | | | | | | send only |

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

## Account self profile

This capability requires Adapter Feature API `^2.1.0`. Tools using the bound account-profile
context require Tool Feature API `^1.1.0`. These are additive capability floors; existing
compatible plugins remain supported by the newer providers.

Expose account nickname, gender, age, birthday, signature, avatar, interests and biography through the optional
`profile` hook of `createEndpointSpecification`. The Endpoint instance `name` remains its instance
identifier; a group card remains scene-specific. Native Client methods and type inference are unchanged.

The hook exposes already-observed `current` facts without IO, `read({ signal })`, actual
`writableFields`, and optional `write({ change, signal })`. Write one field at a time and return
`updated`, `rejected` or `unknown` according to the native result. Do not retry an unknown effect.
Never advertise an unsupported setter or return image bytes as avatar facts.

The framework binds this port to the original Client and operation lifetime. Old ports cannot write
a replacement account. Ordinary turns reuse the incarnation's successful observation;
`get_self_profile` explicitly refreshes it. `set_self_profile` targets the current account and retains
the existing identity approval. An age must never be converted into an invented birthday. See
[Configuration](../configuration/index.md#account-self-profile) for fallback values.
