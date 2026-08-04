import {
  formatLegacyConversationRef,
  formatLegacyMessageRef,
  type ConversationTarget,
  type MessageTarget,
} from '@zhin.js/im-contract';

/**
 * Transport-neutral control plane for a live endpoint.
 *
 * Sending belongs to EndpointInstance.send(). This port intentionally owns
 * operations that address an existing platform message, so Core never needs
 * to know a protocol's method names or identifier layout.
 */
export interface EndpointControl {
  recall?(message: MessageTarget): Promise<void>;
  edit?(message: MessageTarget, content: unknown): Promise<string | null>;
  addReaction?(
    message: MessageTarget,
    emoji: string,
    hint?: { readonly sceneType?: string; readonly channelId?: string },
  ): Promise<string | null>;
  removeReaction?(message: MessageTarget, reactionId: string): Promise<void>;
  typing?(conversation: ConversationTarget, active?: boolean): Promise<void>;
}

export interface EndpointWithControl {
  readonly control?: EndpointControl;
}

interface LegacyEndpointControlSurface {
  recallMessage?(messageId: string): Promise<void>;
  $recallMessage?(messageId: string): Promise<void>;
  editMessage?(messageId: string, content: unknown): Promise<string | null>;
  $editMessage?(messageId: string, content: unknown): Promise<string | null>;
  addReaction?(
    messageId: string,
    emoji: string,
    hint?: { readonly sceneType?: string; readonly channelId?: string },
  ): Promise<string | null>;
  $addReaction?(
    messageId: string,
    emoji: string,
    hint?: { readonly sceneType?: string; readonly channelId?: string },
  ): Promise<string | null>;
  removeReaction?(messageId: string, reactionId: string): Promise<void>;
  $removeReaction?(messageId: string, reactionId: string): Promise<void>;
  typing?(target: string, active?: boolean): Promise<void>;
  $typing?(target: string, active?: boolean): Promise<void>;
}

/**
 * Resolves the public control port. The legacy branch is deliberately kept in
 * Adapter only: it is a migration bridge for existing protocol endpoints, not
 * an IM Core extension point. New adapters must expose `control` directly.
 */
export function resolveEndpointControl(endpoint: unknown): EndpointControl | undefined {
  if (!endpoint || typeof endpoint !== 'object') return undefined;
  const explicit = (endpoint as EndpointWithControl).control;
  if (explicit && typeof explicit === 'object') return explicit;

  const legacy = endpoint as LegacyEndpointControlSurface;
  const recall = legacy.recallMessage ?? legacy.$recallMessage;
  const edit = legacy.editMessage ?? legacy.$editMessage;
  const addReaction = legacy.addReaction ?? legacy.$addReaction;
  const removeReaction = legacy.removeReaction ?? legacy.$removeReaction;
  const typing = legacy.typing ?? legacy.$typing;
  if (!recall && !edit && !addReaction && !removeReaction && !typing) return undefined;

  return Object.freeze({
    ...(recall
      ? { recall: (message: MessageTarget) => recall.call(endpoint, legacyMessageId(message)) }
      : {}),
    ...(edit
      ? {
        edit: (message: MessageTarget, content: unknown) =>
          edit.call(endpoint, legacyMessageId(message), content),
      }
      : {}),
    ...(addReaction
      ? {
        addReaction: (
          message: MessageTarget,
          emoji: string,
          hint?: { readonly sceneType?: string; readonly channelId?: string },
        ) => addReaction.call(endpoint, legacyMessageId(message), emoji, hint),
      }
      : {}),
    ...(removeReaction
      ? {
        removeReaction: (message: MessageTarget, reactionId: string) =>
          removeReaction.call(endpoint, legacyMessageId(message), reactionId),
      }
      : {}),
    ...(typing
      ? {
        typing: (conversation: ConversationTarget, active?: boolean) =>
          typing.call(endpoint, legacyConversationTarget(conversation), active),
      }
      : {}),
  });
}

function legacyMessageId(message: MessageTarget): string {
  return typeof message === 'string' ? message : formatLegacyMessageRef(message);
}

function legacyConversationTarget(conversation: ConversationTarget): string {
  return typeof conversation === 'string' ? conversation : formatLegacyConversationRef(conversation);
}

/** Checks only an Endpoint's explicit `control` port, never the legacy bridge. */
export function hasExplicitEndpointOperation(
  endpoint: unknown,
  operation: 'recall' | 'edit' | 'reaction' | 'typing',
): boolean {
  if (!endpoint || typeof endpoint !== 'object') return false;
  const control = (endpoint as EndpointWithControl).control;
  if (!control || typeof control !== 'object') return false;
  switch (operation) {
    case 'recall': return typeof control.recall === 'function';
    case 'edit': return typeof control.edit === 'function';
    case 'reaction': return typeof control.addReaction === 'function';
    case 'typing': return typeof control.typing === 'function';
  }
}

/** Rejects a declaration that cannot be fulfilled by the explicit control port. */
export function assertDeclaredEndpointOperations(
  endpoint: unknown,
  operations: readonly ('recall' | 'edit' | 'reaction' | 'typing')[] | undefined,
  id: string,
): void {
  for (const operation of operations ?? []) {
    if (!hasExplicitEndpointOperation(endpoint, operation)) {
      throw new TypeError(
        `Adapter Endpoint ${id} declares ${operation} but control.${controlMethodName(operation)} is missing`,
      );
    }
  }
}

function controlMethodName(operation: 'recall' | 'edit' | 'reaction' | 'typing'): string {
  return operation === 'reaction' ? 'addReaction' : operation;
}
