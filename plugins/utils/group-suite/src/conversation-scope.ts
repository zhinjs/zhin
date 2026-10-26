import { createDeliveryTarget, type DeliveryTarget } from 'zhin.js';
import { adapterFeatureId, type AdapterIndex } from 'zhin.js/adapter';
import type { ToolInvocationOrigin } from '@zhin.js/tool';

export interface ConversationInput {
  readonly locale?: import('zhin.js/i18n').Locale;
  readonly conversation?: DeliveryTarget;
  readonly sender?: Readonly<{ id: string; name?: string }>;
  readonly content?: unknown;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Versioned, unambiguous identity; historical bare group ids are deliberately not read. */
export function conversationKey(target: DeliveryTarget): string {
  const canonical = createDeliveryTarget({ conversation: target });
  return JSON.stringify(['conversation-v1', canonical.endpoint.adapter, canonical.endpoint.id,
    canonical.kind, canonical.id, canonical.parent?.kind ?? null, canonical.parent?.id ?? null,
    canonical.threadId ?? null]);
}

export function requireConversation(input: ConversationInput): DeliveryTarget {
  if (!input.conversation) throw new Error('Group Suite requires a canonical conversation');
  return createDeliveryTarget({ conversation: input.conversation });
}

/** Tool origins contain an endpoint selector, not a canonical endpoint capability id. */
export function toolGroupConversation(context: {
  readonly origin: ToolInvocationOrigin;
  project<T>(feature: typeof adapterFeatureId): T;
}, groupId?: string): DeliveryTarget {
  if (context.origin.kind !== 'im' || context.origin.scope !== 'group') {
    throw new Error('Group Suite query tools require a group IM origin');
  }
  const origin = context.origin;
  const index = context.project<AdapterIndex>(adapterFeatureId);
  const matches = index.describe().filter(endpoint =>
    (String(endpoint.id) === origin.endpoint || endpoint.name === origin.endpoint)
    && index.clientAdapter(endpoint.id) === origin.platform);
  if (matches.length !== 1) throw new Error('Group Suite tool endpoint is missing or ambiguous');
  return createDeliveryTarget({ conversation: {
    endpoint: { id: String(matches[0]!.id), adapter: origin.platform },
    kind: 'group', id: groupId ?? origin.sceneId,
    ...(origin.threadId !== undefined && (groupId === undefined || groupId === origin.sceneId)
      ? { threadId: origin.threadId } : {}),
  } });
}
