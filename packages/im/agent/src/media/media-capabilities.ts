import {
  DEFAULT_OUTBOUND_CAPABILITIES,
  type OutboundMediaCapabilities,
} from './media-types.js';

export function resolveOutboundCapabilities(platform?: string): OutboundMediaCapabilities {
  if (!platform) return { ...DEFAULT_OUTBOUND_CAPABILITIES };
  return { ...DEFAULT_OUTBOUND_CAPABILITIES };
}
