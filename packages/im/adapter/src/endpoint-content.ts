import type {
  ConversationReference,
  ConversationResolution,
} from '@zhin.js/im-contract';

export interface EndpointContentResolveContext {
  readonly signal: AbortSignal;
  readonly maxDepth: number;
  readonly maxEntries: number;
  readonly maxChars: number;
}

/** Platform semantic port for resolving content that was not observed locally. */
export interface EndpointContentPort {
  resolve(
    reference: ConversationReference,
    context: EndpointContentResolveContext,
  ): Promise<ConversationResolution>;
}

export function endpointContentOf(endpoint: unknown): EndpointContentPort | undefined {
  if (!endpoint || typeof endpoint !== 'object') return undefined;
  const content = (endpoint as { readonly content?: unknown }).content;
  if (!content || typeof content !== 'object') return undefined;
  return typeof (content as { readonly resolve?: unknown }).resolve === 'function'
    ? content as EndpointContentPort
    : undefined;
}
