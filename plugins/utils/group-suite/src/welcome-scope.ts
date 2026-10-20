import { createDeliveryTarget, type DeliveryTarget } from 'zhin.js';
import { conversationKey } from './conversation-scope.js';

/** Validate without resolving aliases, retaining clients or introducing another scope store. */
export function normalizeWelcomeConversations(value: unknown): readonly DeliveryTarget[] {
  if (!Array.isArray(value) || value.length > 100) throw new TypeError('welcomeConversations must contain at most 100 exact group conversations');
  return Object.freeze(value.map(entry => {
    const target = createDeliveryTarget({ conversation: entry });
    if (target.kind !== 'group') throw new TypeError('welcomeConversations only supports group conversations');
    return target;
  }));
}

/** Missing parent/thread matches absence, never all descendants or threads. */
export function welcomeConversationAllowed(scopes: readonly DeliveryTarget[] | undefined, target: DeliveryTarget): boolean {
  if (scopes === undefined) return true;
  const key = conversationKey(target);
  return scopes.some(scope => conversationKey(scope) === key);
}
