import type { ConversationRef, MessageRef } from '@zhin.js/im-contract';

/**
 * Transport-neutral control plane for a live endpoint.
 *
 * Sending belongs to Endpoint.send(). This port intentionally owns
 * operations that address an existing platform message, so Core never needs
 * to know a protocol's method names or identifier layout.
 */
export interface EndpointControl {
  recall?(message: MessageRef): Promise<void>;
  edit?(message: MessageRef, content: unknown): Promise<string | null>;
  addReaction?(
    message: MessageRef,
    emoji: string,
    hint?: { readonly sceneType?: string; readonly channelId?: string },
  ): Promise<string | null>;
  removeReaction?(message: MessageRef, reactionId: string): Promise<void>;
  typing?(conversation: ConversationRef, active?: boolean): Promise<void>;
}

export interface EndpointWithControl {
  readonly control?: EndpointControl;
}

/** Bridges the common platform `recall(messageId)` shape into canonical control. */
export function createRecallEndpointControl(
  recallById: (messageId: string) => void | Promise<void>,
): Readonly<EndpointControl> {
  return Object.freeze<EndpointControl>({
    recall: (message) => Promise.resolve(recallById(message.id)),
  });
}

/** Reads the canonical control port without probing protocol-specific methods. */
export function endpointControlOf(endpoint: unknown): EndpointControl | undefined {
  if (!endpoint || typeof endpoint !== 'object') return undefined;
  const explicit = (endpoint as EndpointWithControl).control;
  return explicit && typeof explicit === 'object' ? explicit : undefined;
}

/** Checks only an Endpoint's explicit `control` port; protocol methods are never probed. */
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

/** Lists the semantic operations implemented by an Endpoint's explicit control port. */
export function listExplicitEndpointOperations(
  endpoint: unknown,
): readonly ('recall' | 'edit' | 'reaction' | 'typing')[] {
  if (!endpoint || typeof endpoint !== 'object') return Object.freeze([]);
  const control = (endpoint as EndpointWithControl).control;
  if (!control || typeof control !== 'object') return Object.freeze([]);
  const operations: Array<'recall' | 'edit' | 'reaction' | 'typing'> = [];
  if (typeof control.recall === 'function') operations.push('recall');
  if (typeof control.edit === 'function') operations.push('edit');
  if (
    typeof control.addReaction === 'function'
    || typeof control.removeReaction === 'function'
  ) operations.push('reaction');
  if (typeof control.typing === 'function') operations.push('typing');
  return Object.freeze(operations);
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
  const declared = new Set(operations ?? []);
  for (const operation of listExplicitEndpointOperations(endpoint)) {
    if (!declared.has(operation)) {
      throw new TypeError(
        `Adapter Endpoint ${id} exposes control.${explicitControlMethodName(endpoint, operation)} but does not declare ${operation}`,
      );
    }
  }
}

function controlMethodName(operation: 'recall' | 'edit' | 'reaction' | 'typing'): string {
  return operation === 'reaction' ? 'addReaction' : operation;
}

function explicitControlMethodName(
  endpoint: unknown,
  operation: 'recall' | 'edit' | 'reaction' | 'typing',
): string {
  if (operation !== 'reaction') return operation;
  const control = (endpoint as EndpointWithControl).control;
  return typeof control?.addReaction === 'function' ? 'addReaction' : 'removeReaction';
}
