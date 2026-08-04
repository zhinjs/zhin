/**
 * Transport-neutral control plane for a live endpoint.
 *
 * Sending belongs to EndpointInstance.send(). This port intentionally owns
 * operations that address an existing platform message, so Core never needs
 * to know a protocol's method names or identifier layout.
 */
export interface EndpointControl {
  recall?(messageId: string): Promise<void>;
  addReaction?(
    messageId: string,
    emoji: string,
    hint?: { readonly sceneType?: string; readonly channelId?: string },
  ): Promise<string | null>;
  removeReaction?(messageId: string, reactionId: string): Promise<void>;
}

export interface EndpointWithControl {
  readonly control?: EndpointControl;
}

interface LegacyEndpointControlSurface {
  recallMessage?(messageId: string): Promise<void>;
  $recallMessage?(messageId: string): Promise<void>;
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
  const addReaction = legacy.addReaction ?? legacy.$addReaction;
  const removeReaction = legacy.removeReaction ?? legacy.$removeReaction;
  if (!recall && !addReaction && !removeReaction) return undefined;

  return Object.freeze({
    ...(recall ? { recall: (messageId: string) => recall.call(endpoint, messageId) } : {}),
    ...(addReaction
      ? {
        addReaction: (
          messageId: string,
          emoji: string,
          hint?: { readonly sceneType?: string; readonly channelId?: string },
        ) => addReaction.call(endpoint, messageId, emoji, hint),
      }
      : {}),
    ...(removeReaction
      ? {
        removeReaction: (messageId: string, reactionId: string) =>
          removeReaction.call(endpoint, messageId, reactionId),
      }
      : {}),
  });
}
