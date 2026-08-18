import type { ConversationRef, MessageRef } from '@zhin.js/im-contract';

/**
 * Transport-neutral control plane for a live endpoint.
 *
 * Sending belongs to EndpointInstance.send(). This port intentionally owns
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

/** Reads the canonical control port without probing protocol-specific methods. */
export function endpointControlOf(endpoint: unknown): EndpointControl | undefined {
  if (!endpoint || typeof endpoint !== 'object') return undefined;
  const explicit = (endpoint as EndpointWithControl).control;
  return explicit && typeof explicit === 'object' ? explicit : undefined;
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
