import type { BridgeParentSession } from '@zhin.js/bridge-ipc'
import type {
  BridgeGlueInstanceKey,
  BridgeGlueStartSpec,
  BridgeSupervisor,
} from '@zhin.js/bridge-supervisor'
import type { Message } from '@zhin.js/core'
import type { MessageMiddleware, RegisteredAdapter } from '@zhin.js/core'

import { setBridgeInboundGlueState } from './carrier.js'
import { runBridgeGlueDispatch } from './run-dispatch.js'
import type { RunBridgeGlueDispatchOptions } from './run-dispatch.js'

export interface CreateBridgeGlueMiddlewareOptions {
  /**
   * Returns the active stdio session for this message. Typical pattern:
   * `() => supervisor.getSession(instanceKey)` once {@link BridgeSupervisor.start} succeeded.
   */
  getSession: (message: Message) => BridgeParentSession | null | undefined
  k1Ms?: number
  buildPayload?: RunBridgeGlueDispatchOptions['buildPayload']
  binarySpillover?: RunBridgeGlueDispatchOptions['binarySpillover']
  supervisor?: BridgeSupervisor
  instanceKey?: BridgeGlueInstanceKey
  circuitBreaker?: RunBridgeGlueDispatchOptions['circuitBreaker']
}

/**
 * Root `Plugin` message middleware: runs Bridge `dispatch` / `dispatch_result` before `next()`.
 *
 * **Ordering (E1/F2):** register with `plugin.root.addMiddleware` **after** command / prompt
 * middleware so this sits **closer to** the inner `next()` (typically `MessageDispatcher.dispatch`).
 *
 * **Short-circuit:** only when {@link getBridgeInboundGlueState} reports `bridgeStatus === "ok"`
 * and `shortCircuit === true`; then `next()` is skipped.
 */
export function createBridgeGlueMiddleware(
  options: CreateBridgeGlueMiddlewareOptions,
): MessageMiddleware<RegisteredAdapter> {
  const { getSession, k1Ms, buildPayload, binarySpillover, supervisor, instanceKey, circuitBreaker } = options

  return async (message, next) => {
    const session = getSession(message)
    if (!session) {
      setBridgeInboundGlueState(message, {
        bridgeStatus: 'error',
        shortCircuit: false,
        lastError: 'getSession() returned null/undefined',
      })
      await next()
      return
    }

    const { shortCircuitInbound } = await runBridgeGlueDispatch({
      message,
      session,
      k1Ms,
      buildPayload,
      binarySpillover,
      supervisor,
      instanceKey,
      circuitBreaker,
    })
    if (!shortCircuitInbound) {
      await next()
    }
  }
}
