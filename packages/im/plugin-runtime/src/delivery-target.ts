/** JSON-safe identity of one exact endpoint and conversation. */
export type DeliveryTarget = Readonly<{
  readonly endpoint: Readonly<{ readonly adapter: string; readonly id: string }>;
  readonly kind: 'private' | 'group' | 'channel';
  readonly id: string;
  readonly parent?: Readonly<{ readonly kind: 'private' | 'group' | 'channel'; readonly id: string }>;
  readonly threadId?: string;
}>;

/** Copies public message identity only; never retains a Message, client or generation. */
export function createDeliveryTarget(message: { readonly conversation: DeliveryTarget }): DeliveryTarget {
  return normalizeDeliveryTarget(message.conversation);
}

/** Validate persisted/untrusted input, returning only the canonical address fields. */
export function normalizeDeliveryTarget(value: unknown): DeliveryTarget {
  const target = record(value, 'delivery target');
  const endpoint = record(target.endpoint, 'delivery target endpoint');
  const result: DeliveryTarget = {
    endpoint: Object.freeze({ adapter: identifier(endpoint.adapter), id: identifier(endpoint.id) }),
    kind: kind(target.kind),
    id: identifier(target.id),
    ...(target.parent === undefined ? {} : { parent: parent(target.parent) }),
    ...(target.threadId === undefined ? {} : { threadId: identifier(target.threadId) }),
  };
  return Object.freeze(result);
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`Invalid ${name}`);
  return value as Record<string, unknown>;
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError('Delivery identity must be a nonempty string');
  return value;
}

function kind(value: unknown): DeliveryTarget['kind'] {
  if (value !== 'private' && value !== 'group' && value !== 'channel') throw new TypeError('Invalid conversation kind');
  return value;
}

function parent(value: unknown): NonNullable<DeliveryTarget['parent']> {
  const address = record(value, 'conversation parent');
  return Object.freeze({ kind: kind(address.kind), id: identifier(address.id) });
}
