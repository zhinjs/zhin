import type { Adapter } from '../../adapter.js';
import {
  DEFAULT_AI_OUTBOUND_CAPABILITIES,
  type AiOutboundCapabilities,
  type AiOutboundExtensionDefinition,
} from './types.js';

type AdapterCtor = typeof Adapter & {
  aiOutboundCapabilities?: AiOutboundCapabilities;
  aiOutboundExtensions?: readonly AiOutboundExtensionDefinition[];
};

export function getAdapterAiOutboundCapabilities(
  adapterInstance: object,
): AiOutboundCapabilities {
  const ctor = adapterInstance.constructor as AdapterCtor;
  return ctor.aiOutboundCapabilities ?? DEFAULT_AI_OUTBOUND_CAPABILITIES;
}

export function getAdapterAiOutboundExtensions(
  adapterInstance: object,
): readonly AiOutboundExtensionDefinition[] {
  const ctor = adapterInstance.constructor as AdapterCtor;
  return ctor.aiOutboundExtensions ?? [];
}
