import { unlink } from 'node:fs/promises'

import { BridgeEofError, BridgeFrameError, type BridgeParentSession } from '@zhin.js/bridge-ipc'
import type { BridgeGlueInstanceKey, BridgeGlueStartSpec, BridgeSupervisor } from '@zhin.js/bridge-supervisor'
import type { Message } from '@zhin.js/core'

import type { BinarySpilloverOptions } from './binary-spillover.js'
import { setBridgeInboundGlueState } from './carrier.js'
import { circuitKeyForGlue, recordBridgeGlueFailureAndMaybeTrip, resetCircuitFailureStreak } from './circuit.js'
import { parseBridgeDispatchResultPayload } from './parse-result-payload.js'
import { serializeMessageForBridgeDispatch } from './serialize.js'
import type { BridgeInboundGlueState, BridgeInboundStatus } from './types.js'

export interface RunBridgeGlueDispatchOptions {
  message: Message
  session: BridgeParentSession
  /** K1 (ms). Passed to {@link BridgeParentSession.waitForDispatchResult}. Default `5000`. */
  k1Ms?: number
  /** Override default {@link serializeMessageForBridgeDispatch} payload. */
  buildPayload?: (message: Message) => unknown
  /**
   * When set (and {@link buildPayload} is not), serializes the message with M1 binary spillover
   * before `dispatch`. Parent creates temp files and deletes them after the round-trip
   * (including timeout / error); see package README.
   */
  binarySpillover?: BinarySpilloverOptions
  /**
   * When set with {@link instanceKey}, and the supervisor reports the instance disabled (S1),
   * the glue writes `bridgeStatus: "disabled"` and does not touch IPC.
   */
  supervisor?: BridgeSupervisor
  instanceKey?: BridgeGlueInstanceKey
  /**
   * Optional circuit breaker: after `failureThreshold` consecutive `timeout`/`error`
   * outcomes for the same `circuitKey`, invokes `supervisor.restart(instanceKey, startSpec)`.
   */
  circuitBreaker?: {
    enabled: boolean
    failureThreshold: number
    supervisor: BridgeSupervisor
    instanceKey: BridgeGlueInstanceKey
    startSpec: BridgeGlueStartSpec
    /** Defaults to {@link formatGlueInstanceKey} of `instanceKey`. */
    circuitKey?: string
  }
}

export interface RunBridgeGlueDispatchResult {
  /**
   * When `true`, the inbound middleware must **not** call `next()` (skip dispatcher and
   * subsequent inner nodes). Only allowed when `bridgeStatus === "ok"` and the child asked
   * for `shortCircuit` (ADR 0008).
   */
  shortCircuitInbound: boolean
}

function finalizeState(message: Message, state: BridgeInboundGlueState): RunBridgeGlueDispatchResult {
  setBridgeInboundGlueState(message, state)
  const short =
    state.bridgeStatus === 'ok' && state.shortCircuit === true ? true : false
  return { shortCircuitInbound: short }
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function isK1Timeout(err: unknown): boolean {
  return err instanceof BridgeFrameError && err.message.includes('dispatch_result timeout')
}

function classifyWaitError(err: unknown): BridgeInboundStatus {
  if (isK1Timeout(err)) return 'timeout'
  return 'error'
}

async function maybeTripCircuit(
  options: RunBridgeGlueDispatchOptions,
  status: BridgeInboundStatus,
): Promise<void> {
  const cb = options.circuitBreaker
  if (!cb?.enabled || (status !== 'timeout' && status !== 'error')) {
    return
  }
  const mapKey = cb.circuitKey ?? circuitKeyForGlue(cb.instanceKey)
  await recordBridgeGlueFailureAndMaybeTrip({
    mapKey,
    threshold: cb.failureThreshold,
    onTrip: () => cb.supervisor.restart(cb.instanceKey, cb.startSpec),
  })
}

/**
 * One Bridge v1 inbound round-trip: write `dispatch`, wait for `dispatch_result` under K1,
 * persist {@link BridgeInboundGlueState} on the message carrier, optional circuit trip.
 *
 * **L1:** On `timeout`, `error`, or `disabled`, `shortCircuitInbound` is always `false`
 * (chain continues unless an outer middleware stops it).
 */
export async function runBridgeGlueDispatch(
  options: RunBridgeGlueDispatchOptions,
): Promise<RunBridgeGlueDispatchResult> {
  const { message, session, supervisor, instanceKey } = options
  const k1Ms = options.k1Ms ?? 5000

  if (supervisor && instanceKey && !supervisor.isGlueEnabled(instanceKey)) {
    return finalizeState(message, {
      bridgeStatus: 'disabled',
      shortCircuit: false,
      lastError: 'glue instance disabled (S1)',
    })
  }

  if (session.ended) {
    await maybeTripCircuit(options, 'error')
    return finalizeState(message, {
      bridgeStatus: 'error',
      shortCircuit: false,
      lastError: 'IPC session ended before dispatch',
    })
  }

  let spillPaths: string[] = []
  let payload: unknown
  if (options.buildPayload) {
    payload = options.buildPayload(message)
  } else if (options.binarySpillover) {
    const r = serializeMessageForBridgeDispatch(message, { binarySpillover: options.binarySpillover })
    payload = r.payload
    spillPaths = r.spillPaths
  } else {
    payload = serializeMessageForBridgeDispatch(message)
  }

  try {
    const dispatchId = session.sendDispatch(payload)
    try {
      const resultPayload = await session.waitForDispatchResult(dispatchId, k1Ms)
      const parsed = parseBridgeDispatchResultPayload(resultPayload)
      const cb = options.circuitBreaker
      if (cb?.enabled) {
        resetCircuitFailureStreak(cb.circuitKey ?? circuitKeyForGlue(cb.instanceKey))
      }
      return finalizeState(message, {
        bridgeStatus: 'ok',
        shortCircuit: parsed.shortCircuit,
        handled: parsed.handled,
        dispatchId,
        resultPayload,
      })
    } catch (err) {
      const status = classifyWaitError(err)
      await maybeTripCircuit(options, status)
      return finalizeState(message, {
        bridgeStatus: status,
        shortCircuit: false,
        dispatchId,
        lastError: err instanceof BridgeEofError || err instanceof BridgeFrameError ? err.message : errMessage(err),
      })
    }
  } finally {
    await Promise.all(spillPaths.map((p) => unlink(p).catch(() => {})))
  }
}
