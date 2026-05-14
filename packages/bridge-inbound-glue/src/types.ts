/**
 * Normalized parent-side outcome for one `dispatch` / `dispatch_result` round-trip
 * (ADR 0008).
 */
export type BridgeInboundStatus = 'ok' | 'timeout' | 'error' | 'disabled'

export interface BridgeInboundGlueState {
  bridgeStatus: BridgeInboundStatus
  /** Only `true` when `bridgeStatus === "ok"` and child completion frame set it. */
  shortCircuit: boolean
  /** Optional observability from child; does not affect chain continuation. */
  handled?: boolean
  /** Wire id used for this round-trip (when a dispatch was sent). */
  dispatchId?: string
  /** Raw `dispatch_result.payload` when `bridgeStatus === "ok"`. */
  resultPayload?: unknown
  /** Best-effort detail when status is `error` or IPC failed before ok. */
  lastError?: string
}
