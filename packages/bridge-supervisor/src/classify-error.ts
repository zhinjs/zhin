import {
  BridgeEofError,
  BridgeFrameError,
  BridgeHandshakeError,
} from '@zhin.js/bridge-ipc'

import type { BridgeGlueDisabledReason, BridgeGlueLastError } from './types.js'

export function toLastError(err: unknown): BridgeGlueLastError {
  if (err instanceof Error) {
    const code =
      'code' in err && typeof (err as { code?: unknown }).code === 'string'
        ? (err as { code: string }).code
        : undefined
    return { message: err.message, name: err.name, code }
  }
  return { message: String(err), name: 'Error' }
}

export function classifyGlueFailure(err: unknown): {
  reason: BridgeGlueDisabledReason
  last: BridgeGlueLastError
} {
  const last = toLastError(err)
  if (err instanceof BridgeHandshakeError) {
    const wire = err.code
    if (wire === 'token_mismatch' || wire === 'version_mismatch' || wire === 'invalid_hello') {
      return { reason: 'handshake_rejected', last: { ...last, code: wire } }
    }
    return { reason: 'handshake_protocol', last: { ...last, code: wire } }
  }
  if (err instanceof BridgeFrameError) {
    return { reason: 'frame_error', last }
  }
  if (err instanceof BridgeEofError) {
    return { reason: 'eof', last }
  }
  const msg = last.message.toLowerCase()
  if (msg.includes('spawn') || msg.includes('enoent') || last.code === 'ENOENT') {
    return { reason: 'spawn_failed', last }
  }
  return { reason: 'unknown', last }
}
