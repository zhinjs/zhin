import type { ConversationRef } from '@zhin.js/im-contract';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { createToken, type PluginId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';

/** Keep the adapter's presentation or prefer its existing readable text fallback. */
export type OutboundPresentationMode = 'default' | 'text';

export interface OutboundPresentationPreferences {
  readonly html?: OutboundPresentationMode;
  readonly markdown?: OutboundPresentationMode;
  readonly interactive?: OutboundPresentationMode;
}

export interface OutboundPresentationContext {
  readonly conversation: ConversationRef;
  readonly requester: PluginId;
  readonly generation: number;
}

/** A synchronous, side-effect-free decision, shared by delivery and target previews. */
export type OutboundPresentation = (
  context: OutboundPresentationContext,
) => OutboundPresentationPreferences | undefined;

export const outboundPresentationToken = createToken<OutboundPresentation>(
  'zhin.outbound-presentation',
  'Root-selected outbound presentation within the adapter capability boundary',
);

const logger = getLogger('im.outbound');

/** Resolve once per operation; replacements reuse this detached, immutable decision. */
export function resolveOutboundPresentation(
  snapshot: RuntimeSnapshot,
  conversation: ConversationRef,
  requester: PluginId,
): OutboundPresentationPreferences | undefined {
  const policy = snapshot.resources.get(snapshot.root)?.get(outboundPresentationToken.id) as OutboundPresentation | undefined;
  if (policy === undefined) return undefined;
  try {
    const view: ConversationRef = Object.freeze({
      endpoint: Object.freeze({ id: conversation.endpoint.id, adapter: conversation.endpoint.adapter }),
      kind: conversation.kind,
      id: conversation.id,
      ...(conversation.parent ? { parent: Object.freeze({ kind: conversation.parent.kind, id: conversation.parent.id }) } : {}),
      ...(conversation.threadId !== undefined ? { threadId: conversation.threadId } : {}),
    });
    const result = policy(Object.freeze({ conversation: view, requester, generation: snapshot.generation }));
    if (result === undefined) return undefined;
    if (result && typeof result === 'object' && 'then' in result) {
      // An accidentally async policy is outside the contract. Consume a possible
      // rejection without waiting for it or applying a later decision to this send.
      void Promise.resolve(result).catch(() => undefined);
      throw new TypeError('Outbound presentation must be synchronous');
    }
    if (!result || typeof result !== 'object') throw new TypeError('Invalid outbound presentation');
    const { html, markdown, interactive } = result;
    for (const value of [html, markdown, interactive]) {
      if (value !== undefined && value !== 'default' && value !== 'text') throw new TypeError('Invalid outbound presentation mode');
    }
    return Object.freeze({ html, markdown, interactive });
  } catch {
    // Never log the callback error, content or user-provided values; do not retry it.
    logger.warn(formatCompact({ op: 'outbound_presentation', status: 'fallback', reason: 'policy_failed', generation: snapshot.generation }));
    return undefined;
  }
}
