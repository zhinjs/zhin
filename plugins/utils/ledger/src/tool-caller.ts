import { resolveLocale, type Locale } from 'zhin.js/i18n';
import { createDeliveryTarget, type DeliveryTarget } from 'zhin.js';
import { adapterFeatureId, type AdapterIndex } from 'zhin.js/adapter';
import { messages as t } from './i18n.js';
import { LedgerInputError, ledgerOwnerKey, type LedgerCaller } from './identity.js';

export type LedgerToolOrigin =
  | Readonly<{
      kind: 'im';
      platform: string;
      endpoint: string;
      scope: 'private' | 'group' | 'channel';
      sceneId: string;
      messageId?: string;
      threadId?: string;
      conversation?: DeliveryTarget & Readonly<{ name?: string }>;
    }>
  | Readonly<{ kind: Exclude<string, 'im'>; [key: string]: unknown }>;

export interface LedgerToolCallerContext {
  readonly origin: LedgerToolOrigin;
  readonly locale?: Locale;
  readonly senderId?: string;
  readonly principal?: Readonly<{ subjectId: string; roles: readonly string[] }>;
  project?<T>(feature: typeof adapterFeatureId): T;
}

function isImOrigin(
  origin: LedgerToolOrigin,
): origin is Extract<LedgerToolOrigin, { readonly kind: 'im' }> {
  return origin.kind === 'im';
}

function resolveToolConversation(context: LedgerToolCallerContext, locale: Locale): DeliveryTarget {
  const origin = context.origin;
  if (!isImOrigin(origin)) {
    throw new LedgerInputError(t(locale, 'actor'));
  }
  let endpointId = origin.conversation?.endpoint.id ?? origin.endpoint;
  if (typeof context.project === 'function') {
    try {
      const index = context.project<AdapterIndex>(adapterFeatureId);
      if (index && typeof index.describe === 'function') {
        const matches = index
          .describe()
          .filter(
            (endpoint) =>
              (String(endpoint.id) === origin.endpoint || endpoint.name === origin.endpoint) &&
              index.clientAdapter(endpoint.id) === origin.platform,
          );
        if (matches.length === 1) {
          endpointId = String(matches[0]!.id);
        }
      }
    } catch {
      // Fall back to origin endpoint when AdapterIndex projection is unavailable in lightweight contexts.
    }
  }
  if (!endpointId) {
    throw new LedgerInputError(t(locale, 'actor'));
  }
  if (origin.conversation) {
    return createDeliveryTarget({
      conversation: {
        ...origin.conversation,
        endpoint: { id: endpointId, adapter: origin.platform },
      },
    });
  }
  return createDeliveryTarget({
    conversation: {
      endpoint: { id: endpointId, adapter: origin.platform },
      kind: origin.scope,
      id: origin.sceneId,
      ...(origin.threadId !== undefined ? { threadId: origin.threadId } : {}),
    },
  });
}

/** Builds a LedgerCaller from an Agent Tool execution context. */
export function ledgerCallerFromTool(context: LedgerToolCallerContext): LedgerCaller {
  const locale = resolveLocale(context.locale);
  const senderId = (context.principal?.subjectId ?? context.senderId)?.trim();
  if (!senderId) {
    throw new LedgerInputError(t(locale, 'actor'));
  }
  const conversation = resolveToolConversation(context, locale);
  const endpoint = conversation.endpoint;
  const isPrivate = conversation.kind === 'private';
  const privateTarget: DeliveryTarget = isPrivate
    ? conversation
    : Object.freeze({ endpoint, kind: 'private', id: senderId });
  return {
    ownerKey: ledgerOwnerKey(endpoint.adapter, endpoint.id, senderId),
    senderId,
    locale,
    conversation,
    privateTarget,
    isPrivate,
  };
}
