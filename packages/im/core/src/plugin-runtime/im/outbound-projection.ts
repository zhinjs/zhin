import { htmlRendererToken, type CapabilityId, type HtmlRendererHost, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { EndpointDeliveryError, type ConversationRef } from '@zhin.js/im-contract';
import { flattenOutboundArray } from '../../built/outbound-content-arrays.js';
import { assertCanonicalSegments } from '../../built/segment-contract/assert.js';
import {
  applyOutboundInteractivePolicy, applyOutboundMarkdownPolicy, normalizeOutboundPayload,
  resolveOutboundHtmlPolicy, resolveOutboundInteractivePolicy, resolveOutboundMarkdownPolicy,
  resolveOutboundMediaPolicy, resolveOutboundSupportedSegments,
} from './outbound-segments.js';
import type { OutboundFallbackReason, RuntimeMessageRendering } from './message-events.js';

export interface OutboundProjection {
  readonly payload: unknown;
  readonly rendering: RuntimeMessageRendering;
}

/** Shared by transport and target-aware previews. Does not send or register callbacks. */
export async function projectOutboundPayload(
  rendered: unknown,
  conversation: ConversationRef,
  snapshot: RuntimeSnapshot,
  options: {
    readonly rememberFallback?: (map: Record<string, string>) => Record<string, string> | void;
    readonly inheritedFallbacks?: readonly OutboundFallbackReason[];
    /** Keep keyboard payloads until outbound middleware has had a chance to replace them. */
    readonly deferInteractive?: boolean;
  } = {},
): Promise<OutboundProjection> {
  const adapter = conversation.endpoint.id as CapabilityId;
  const reasons = new Set(options.inheritedFallbacks);
  const values = Array.isArray(rendered) ? flattenOutboundArray(rendered) : rendered;
  const contains = (type: string) => (Array.isArray(values) ? values : [values])
    .some(value => value && typeof value === 'object' && value.type === type);
  const markdown = resolveOutboundMarkdownPolicy(adapter, snapshot);
  if (markdown === 'text' && contains('markdown')) reasons.add('markdown_text_policy');
  const host = snapshot.resources.get(snapshot.root)?.get(htmlRendererToken.id) as HtmlRendererHost | undefined;
  let payload = await normalizeOutboundPayload(applyOutboundMarkdownPolicy(values, markdown), host, {
    mediaPolicy: resolveOutboundMediaPolicy(adapter, snapshot),
    htmlPolicy: resolveOutboundHtmlPolicy(adapter, snapshot),
    onFallback: reason => reasons.add(reason),
  });
  const interactive = resolveOutboundInteractivePolicy(adapter, snapshot);
  if (interactive === 'text' && Array.isArray(payload) && payload.some(item => item?.type === 'keyboard')) {
    reasons.add('interactive_text_policy');
  }
  if (!options.deferInteractive) payload = applyOutboundInteractivePolicy(payload, interactive, options.rememberFallback);
  if (Array.isArray(payload)) {
    payload = payload.filter(item => !(item?.type === 'text' && item.data?.text === ''));
    assertCanonicalSegments(payload);
  }
  const supported = resolveOutboundSupportedSegments(adapter, snapshot);
  const supportedPayload = options.deferInteractive ? applyOutboundInteractivePolicy(payload, interactive) : payload;
  if (supported && Array.isArray(supportedPayload)) {
    const unsupported = supportedPayload.find(segment => segment && typeof segment === 'object'
      && typeof segment.type === 'string' && !supported.includes(segment.type));
    if (unsupported) throw new EndpointDeliveryError('unsupported_operation', `Adapter does not support canonical segment ${unsupported.type}`, 'not_sent');
  }
  const forms = new Set<'text' | 'image' | 'native'>();
  for (const item of Array.isArray(payload) ? payload : [payload]) {
    if (typeof item === 'string' || item?.type === 'text') forms.add('text');
    else if (item?.type === 'image') forms.add('image');
    else if (item != null) forms.add('native');
  }
  return Object.freeze({ payload, rendering: Object.freeze({
    forms: Object.freeze([...forms]), fallbacks: Object.freeze([...reasons]),
  }) });
}
