/** Current bridge IPC protocol version (hello `protocolVersion`). */
export const BRIDGE_PROTOCOL_VERSION = 1 as const

export type BridgeMessageSource = 'im' | 'queue'

/** J2 — parent → child first frame after spawn. */
export interface BridgeHelloParent {
  kind: 'hello'
  protocolVersion: number
  token: string
}

/** R1 — child → parent response to hello. */
export interface BridgeHelloOk {
  kind: 'hello_ok'
  protocolVersion: number
}

export type BridgeHelloErrorCode = 'token_mismatch' | 'version_mismatch' | 'invalid_hello'

export interface BridgeHelloError {
  kind: 'hello_error'
  code: BridgeHelloErrorCode
}

/** Post-handshake: normalized inbound/outbound envelope (v1 uses `source: im`; `queue` reserved). */
export interface BridgeDispatchEnvelope {
  kind: 'dispatch'
  id: string
  source: 'im'
  /** Reserved for queue-side glue (P3); explicit `null` in v1 reference traffic. */
  queue?: null
  payload: unknown
}

export interface BridgeDispatchResultEnvelope {
  kind: 'dispatch_result'
  id: string
  source: 'im'
  queue?: null
  payload: unknown
}

/**
 * Child → parent: outbound send intent (I2 proactive allowed — {@link correlationId} optional).
 * Wire shape matches other post-handshake envelopes (`source: im`).
 */
export interface BridgeOutboundIntentEnvelope {
  kind: 'outbound_intent'
  id: string
  source: 'im'
  queue?: null
  /** When omitted, parent treats this as proactive outbound without inbound correlation. */
  correlationId?: string
  payload: unknown
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function isHelloOk(v: unknown): v is BridgeHelloOk {
  return isPlainObject(v) && v.kind === 'hello_ok' && typeof v.protocolVersion === 'number'
}

export function isHelloError(v: unknown): v is BridgeHelloError {
  return (
    isPlainObject(v) &&
    v.kind === 'hello_error' &&
    typeof v.code === 'string' &&
    (v.code === 'token_mismatch' || v.code === 'version_mismatch' || v.code === 'invalid_hello')
  )
}

export function isDispatchResult(v: unknown): v is BridgeDispatchResultEnvelope {
  return (
    isPlainObject(v) &&
    v.kind === 'dispatch_result' &&
    typeof v.id === 'string' &&
    v.source === 'im'
  )
}

export function isOutboundIntentEnvelope(v: unknown): v is BridgeOutboundIntentEnvelope {
  if (!isPlainObject(v) || v.kind !== 'outbound_intent') return false
  if (typeof v.id !== 'string' || v.source !== 'im') return false
  if (v.correlationId !== undefined && typeof v.correlationId !== 'string') return false
  return 'payload' in v
}
