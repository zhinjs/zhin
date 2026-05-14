import type { BridgeHelloErrorCode } from './types.js'

/** Malformed line, invalid JSON, or unexpected shape during framing. */
export class BridgeFrameError extends Error {
  readonly category = 'frame' as const
  readonly line?: string

  constructor(message: string, options?: { cause?: unknown; line?: string }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'BridgeFrameError'
    this.line = options?.line
  }
}

/** Stream ended before a complete record or while waiting on handshake. */
export class BridgeEofError extends Error {
  readonly category = 'eof' as const

  constructor(message = 'Unexpected end of IPC stream') {
    super(message)
    this.name = 'BridgeEofError'
  }
}

export type BridgeHandshakeFailureCode =
  | BridgeHelloErrorCode
  | 'unexpected_record'
  | 'protocol_error'

/** Handshake rejected by child or invalid first frame from child. */
export class BridgeHandshakeError extends Error {
  readonly category = 'handshake' as const

  constructor(
    message: string,
    readonly code: BridgeHandshakeFailureCode,
  ) {
    super(message)
    this.name = 'BridgeHandshakeError'
  }
}
