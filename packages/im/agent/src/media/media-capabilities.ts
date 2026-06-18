import { getHostRootPlugin } from '@zhin.js/core';
import {
  DEFAULT_OUTBOUND_CAPABILITIES,
  type OutboundMediaCapabilities,
} from './media-types.js';

export function resolveOutboundCapabilities(platform?: string): OutboundMediaCapabilities {
  if (!platform) return { ...DEFAULT_OUTBOUND_CAPABILITIES };
  const host = getHostRootPlugin();
  if (host) {
    const adapter = host.inject?.(platform) as
      | { getOutboundMediaCapabilities?: () => OutboundMediaCapabilities }
      | undefined;
    return adapter?.getOutboundMediaCapabilities?.() ?? { ...DEFAULT_OUTBOUND_CAPABILITIES };
  }
  return { ...DEFAULT_OUTBOUND_CAPABILITIES };
}
