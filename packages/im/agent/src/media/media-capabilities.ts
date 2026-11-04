import type { EndpointCapabilities, EndpointConversationKind } from '@zhin.js/im-contract';
import {
  DEFAULT_OUTBOUND_CAPABILITIES,
  type OutboundMediaCapabilities,
} from './media-types.js';

/** Minimal read surface shared by `TurnCapabilities` (ADR 0044). */
export interface OutboundCapabilitySource {
  has(path: string): boolean;
}

/**
 * Outbound media limits from what the Endpoint declares: a per-turn `TurnCapabilities`, or the
 * serializable `EndpointCapabilities` of one conversation kind. No source = nothing is assumed
 * (no spool).
 */
export function resolveOutboundCapabilities(
  _platform?: string,
  source?: OutboundCapabilitySource | Readonly<{ capabilities: EndpointCapabilities | undefined; kind: EndpointConversationKind }>,
): OutboundMediaCapabilities {
  const caps = { ...DEFAULT_OUTBOUND_CAPABILITIES };
  if (!source) return caps;
  if ('has' in source) return { ...caps, spool: source.has('delivery.spool') };
  return { ...caps, spool: source.capabilities?.kinds?.[source.kind]?.spool === true };
}
