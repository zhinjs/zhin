import { createDeliveryTarget, hasResource, type DeliveryTarget } from 'zhin.js';
import { memberWelcomeOwnerToken, type MemberWelcomeOwner } from '@zhin.js/core/runtime';

type ConversationRef = Parameters<MemberWelcomeOwner['ownsWelcome']>[0];
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

interface WelcomeOwnerReader {
  readonly has?: (token: typeof memberWelcomeOwnerToken) => boolean;
  use(token: typeof memberWelcomeOwnerToken): MemberWelcomeOwner;
}

/**
 * Whether this plugin sends the welcome in `conversation`: the conversation is in
 * `welcomeConversations` (or the list is omitted) and the Agent session welcome does not own it
 * (#1012 A9 option 2: MemberLifecycle then sends the single welcome).
 */
export function groupSuiteSendsWelcome(
  context: WelcomeOwnerReader,
  scopes: readonly DeliveryTarget[] | undefined,
  conversation: ConversationRef,
): boolean {
  if (!welcomeConversationAllowed(scopes, conversation)) return false;
  if (!hasResource(context as Parameters<typeof hasResource>[0], memberWelcomeOwnerToken)) return true;
  return !context.use(memberWelcomeOwnerToken).ownsWelcome(conversation);
}
