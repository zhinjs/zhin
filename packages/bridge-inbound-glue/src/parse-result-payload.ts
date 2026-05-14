/**
 * Interpret child `dispatch_result.payload` for parent-chain control (ADR 0008).
 * Unknown shapes default to continuing the inbound chain.
 */
export function parseBridgeDispatchResultPayload(payload: unknown): {
  shortCircuit: boolean
  handled?: boolean
} {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { shortCircuit: false }
  }
  const o = payload as Record<string, unknown>
  const shortCircuit = o.shortCircuit === true
  const handled = typeof o.handled === 'boolean' ? o.handled : undefined
  return { shortCircuit, handled }
}
