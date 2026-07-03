import type { StructuredOutboundDetectInput } from './types.js';

/** structured_only：满足任一即进入结构化出站模式。 */
export function isStructuredOutboundRequired(input: StructuredOutboundDetectInput): boolean {
  return Boolean(
    input.collaborationCell
    || input.toolRequiresStructured
    || input.inboundHandoffIntent
    || input.adapterHasExtensions,
  );
}
