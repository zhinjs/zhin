import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import type { BridgeParentSession } from '@zhin.js/bridge-ipc'
import { BridgeSupervisor } from '@zhin.js/bridge-supervisor'
import { compose, type RegisteredAdapter } from '@zhin.js/core'

import {
  createBridgeGlueMiddleware,
  getBridgeInboundGlueState,
  runBridgeGlueDispatch,
  serializeMessageForBridgeDispatch,
} from './index.js'

const echoChild = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../bridge-ipc/bin/echo-child.mjs',
)
const hangChild = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../test-fixtures/hang-after-hello.mjs',
)

function echoSpec(token: string, overrides: Record<string, string> = {}) {
  return {
    command: process.execPath,
    args: [echoChild],
    token,
    ...overrides,
  }
}

function hangSpec(token: string) {
  return {
    command: process.execPath,
    args: [hangChild],
    token,
  }
}

function minimalMessage(overrides: Partial<{ $id: string }> = {}): Parameters<typeof serializeMessageForBridgeDispatch>[0] {
  return {
    $id: overrides.$id ?? 'm-1',
    $adapter: 'test' as never,
    $bot: 'b1',
    $content: [],
    $sender: { id: 'u1', name: 'n' },
    $channel: { id: 'c1', type: 'private' },
    $timestamp: 1,
    $raw: '{}',
    $reply: async () => 'ok',
    $recall: async () => {},
  } as Parameters<typeof serializeMessageForBridgeDispatch>[0]
}

describe('runBridgeGlueDispatch', () => {
  it('echo child: ok + payload echoed', async () => {
    const sup = new BridgeSupervisor()
    const key = { botId: 'b', ecosystem: 'e', instanceId: 'i' }
    const tok = `tok-${Date.now()}`
    await sup.start(key, echoSpec(tok))
    const session = sup.getSession(key)!
    const message = minimalMessage()
    const r = await runBridgeGlueDispatch({ message, session, k1Ms: 3000 })
    expect(r.shortCircuitInbound).toBe(false)
    const st = getBridgeInboundGlueState(message)!
    expect(st.bridgeStatus).toBe('ok')
    expect(st.resultPayload).toEqual(serializeMessageForBridgeDispatch(message))
    await sup.stop(key)
  })

  it('K1 timeout: bridgeStatus timeout, shortCircuit false, L1 continues', async () => {
    const sup = new BridgeSupervisor()
    const key = { botId: 'b', ecosystem: 'e', instanceId: 'hang' }
    const tok = `tok-${Date.now()}`
    await sup.start(key, hangSpec(tok))
    const session = sup.getSession(key)!
    const message = minimalMessage({ $id: 'timeout-case' })
    const r = await runBridgeGlueDispatch({ message, session, k1Ms: 120 })
    expect(r.shortCircuitInbound).toBe(false)
    const st = getBridgeInboundGlueState(message)!
    expect(st.bridgeStatus).toBe('timeout')
    expect(st.shortCircuit).toBe(false)
    await sup.stop(key)
  })

  it('S1 disabled: bridgeStatus disabled without dispatch', async () => {
    const sup = new BridgeSupervisor()
    const key = { botId: 'b', ecosystem: 'e', instanceId: 'bad' }
    const good = `g-${Date.now()}`
    await sup.start(key, echoSpec(good, { helloToken: 'wrong' }))
    expect(sup.isGlueEnabled(key)).toBe(false)
    const message = minimalMessage()
    const r = await runBridgeGlueDispatch({
      message,
      session: undefined as unknown as BridgeParentSession,
      supervisor: sup,
      instanceKey: key,
    })
    expect(r.shortCircuitInbound).toBe(false)
    const st = getBridgeInboundGlueState(message)!
    expect(st.bridgeStatus).toBe('disabled')
  })
})

describe('createBridgeGlueMiddleware', () => {
  it('timeout path still invokes inner next (L1)', async () => {
    const sup = new BridgeSupervisor()
    const key = { botId: 'b', ecosystem: 'e', instanceId: 'mw-hang' }
    const tok = `tok-${Date.now()}`
    await sup.start(key, hangSpec(tok))

    const message = minimalMessage()
    let inner = false
    const mw = createBridgeGlueMiddleware({
      getSession: () => sup.getSession(key),
      k1Ms: 100,
    })
    const chain = compose<RegisteredAdapter>([
      mw,
      async (_m, next) => {
        inner = true
        await next()
      },
    ])
    await chain(message as never, async () => {})
    expect(inner).toBe(true)
    expect(getBridgeInboundGlueState(message)!.bridgeStatus).toBe('timeout')
    await sup.stop(key)
  })

  it('circuit breaker: N timeouts trigger supervisor.restart once', async () => {
    const sup = new BridgeSupervisor()
    const key = { botId: 'b', ecosystem: 'e', instanceId: 'cb' }
    const tok = `tok-${Date.now()}`
    await sup.start(key, hangSpec(tok))
    const restartSpy = vi.spyOn(sup, 'restart')

    const session1 = sup.getSession(key)!
    const m1 = minimalMessage({ $id: '1' })
    await runBridgeGlueDispatch({
      message: m1,
      session: session1,
      k1Ms: 80,
      circuitBreaker: {
        enabled: true,
        failureThreshold: 2,
        supervisor: sup,
        instanceKey: key,
        startSpec: hangSpec(tok),
      },
    })
    expect(restartSpy).not.toHaveBeenCalled()

    const m2 = minimalMessage({ $id: '2' })
    await runBridgeGlueDispatch({
      message: m2,
      session: session1,
      k1Ms: 80,
      circuitBreaker: {
        enabled: true,
        failureThreshold: 2,
        supervisor: sup,
        instanceKey: key,
        startSpec: hangSpec(tok),
      },
    })
    expect(restartSpy).toHaveBeenCalledTimes(1)
    expect(sup.getSession(key)).toBeDefined()

    await sup.stop(key)
  })

  it('ok + shortCircuit: inner middleware not run', async () => {
    const sup = new BridgeSupervisor()
    const key = { botId: 'b', ecosystem: 'e', instanceId: 'sc' }
    const tok = `tok-${Date.now()}`
    await sup.start(key, echoSpec(tok))
    const message = minimalMessage()
    let inner = false
    const mw = createBridgeGlueMiddleware({
      getSession: () => sup.getSession(key),
      k1Ms: 3000,
      buildPayload: () => ({ shortCircuit: true, note: 'nb-stop' }),
    })
    const chain = compose<RegisteredAdapter>([
      mw,
      async (_m, next) => {
        inner = true
        await next()
      },
    ])
    await chain(message as never, async () => {})
    expect(inner).toBe(false)
    expect(getBridgeInboundGlueState(message)!.bridgeStatus).toBe('ok')
    expect(getBridgeInboundGlueState(message)!.shortCircuit).toBe(true)
    await sup.stop(key)
  })
})
