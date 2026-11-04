import type { ProviderSupportMetadata } from '@zhin.js/ai/provider';

/** Public display fields only. Missing or unknown metadata never implies standard support. */
export function projectProviderSupport(
  value: unknown
): ProviderSupportMetadata | undefined {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('status' in value) ||
    (value.status !== 'standard' && value.status !== 'experimental')
  )
    return undefined;
  return Object.freeze({
    status: value.status,
    ...('notice' in value && typeof value.notice === 'string'
      ? { notice: value.notice }
      : {}),
  });
}
