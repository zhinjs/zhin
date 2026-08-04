# @zhin.js/im-contract

`@zhin.js/im-contract` is the zero-dependency, transport-neutral contract for
Zhin IM integrations. It provides stable identities and delivery semantics
without importing Plugin Runtime, a platform SDK, or an AI package.

## Why this package exists

Adapters historically exchanged strings such as `group:123` and occasionally
combined a target with a message id. That makes a colon in a native id, a
thread, or a cross-platform operation ambiguous. Framework code now uses these
structured values instead:

- `ConversationRef`: endpoint-bound conversation identity;
- `ActorRef`: stable platform user identity, distinct from a display name;
- `MessageRef`: a native message id within a conversation;
- `DeliveryReceipt`: serializable outcome of an attempted outbound delivery;
- `EndpointCapabilities`: declared operations rather than optional-method
  detection.

Adapters may use `parseLegacyConversationTarget()` and
`formatLegacyConversationTarget()` only at a legacy platform boundary. New
framework APIs should accept or return the structured forms.

## Example

```ts
import type {
  ConversationRef,
  DeliveryReceipt,
  EndpointCapabilities,
} from '@zhin.js/im-contract';

const capabilities: EndpointCapabilities = {
  inbound: true,
  outbound: true,
  operations: { recall: true },
};

const conversation: ConversationRef = {
  endpoint: { adapter: 'telegram', id: 'telegram~primary' },
  kind: 'group',
  id: '-100123',
};

const receipt: DeliveryReceipt = { status: 'sent' };
```

## Guarantees

- The package has no runtime dependencies.
- Native identifiers are opaque strings and are never split or normalized.
- `ActorRef.id` is suitable for authorization and session keys; `displayName`
  is presentation-only.
- `DeliveryReceipt` contains serializable data only, so it can cross Console,
  HTTP, MCP, A2A, and activity-feedback boundaries.

## Development

```bash
pnpm --filter @zhin.js/im-contract test
pnpm --filter @zhin.js/im-contract build
```
