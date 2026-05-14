import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  BridgeSupervisor,
  formatGlueInstanceKey,
  readTokenFromEnv,
} from './index.js'

const echoChild = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../bridge-ipc/bin/echo-child.mjs',
)

function echoSpec(token: string, overrides: Partial<{ helloToken: string }> = {}) {
  return {
    command: process.execPath,
    args: [echoChild],
    token,
    ...overrides,
  }
}

describe('BridgeSupervisor', () => {
  it('starts echo child: running + alive', async () => {
    const sup = new BridgeSupervisor()
    const key = { botId: 'bot-a', ecosystem: 'test-eco', instanceId: 'n3-1' }
    const tok = `t-${Date.now()}`
    const r = await sup.start(key, echoSpec(tok))
    expect(r.ok).toBe(true)
    expect(r.health.state).toBe('running')
    expect(r.health.alive).toBe(true)
    expect(r.health.disabledReason).toBeNull()
    await sup.stop(key)
  })

  it('S1: handshake token mismatch disables once; second start does not retry or spam logs', async () => {
    const logs: { event: string }[] = []
    const sup = new BridgeSupervisor({
      log: (e) => logs.push({ event: e.event }),
    })
    const key = { botId: 'bot-b', ecosystem: 'eco', instanceId: 'inst-1' }
    const good = `ok-${Date.now()}`
    const spec = echoSpec(good, { helloToken: 'wrong-for-j2' })

    const r1 = await sup.start(key, spec)
    expect(r1.ok).toBe(false)
    expect(r1.health.state).toBe('disabled')
    expect(r1.health.alive).toBe(false)
    expect(r1.health.disabledReason).toBe('handshake_rejected')

    const r2 = await sup.start(key, spec)
    expect(r2.ok).toBe(false)
    expect(r2.skipped).toBe('s1_disabled_until_restart')
    expect(logs.filter((l) => l.event === 'bridge_glue.disabled')).toHaveLength(1)

    const r3 = await sup.restart(key, echoSpec(good))
    expect(r3.ok).toBe(true)
    expect(r3.health.alive).toBe(true)
    await sup.stop(key)
  })

  it('N3: two instance keys are isolated (one failure does not disable the other)', async () => {
    const sup = new BridgeSupervisor()
    const k1 = { botId: 'same-bot', ecosystem: 'eco', instanceId: 'a' }
    const k2 = { botId: 'same-bot', ecosystem: 'eco', instanceId: 'b' }
    const t1 = `x-${Date.now()}-a`
    const t2 = `x-${Date.now()}-b`

    const bad = await sup.start(k1, echoSpec(t1, { helloToken: 'nope' }))
    expect(bad.health.state).toBe('disabled')

    const good = await sup.start(k2, echoSpec(t2))
    expect(good.ok).toBe(true)
    expect(good.health.state).toBe('running')
    expect(good.health.alive).toBe(true)
    expect(sup.isGlueEnabled(k1)).toBe(false)
    expect(sup.isGlueEnabled(k2)).toBe(true)

    await sup.stop(k2)
  })

  it('getSession returns live BridgeParentSession until stop', async () => {
    const sup = new BridgeSupervisor()
    const key = { botId: 'bot-sess', ecosystem: 'eco', instanceId: 's1' }
    const tok = `t-${Date.now()}`
    await sup.start(key, echoSpec(tok))
    const s = sup.getSession(key)
    expect(s).toBeDefined()
    expect(s!.ended).toBe(false)
    await sup.stop(key)
    expect(sup.getSession(key)).toBeUndefined()
  })

  it('formatGlueInstanceKey separates bots and ecosystems', () => {
    const a = formatGlueInstanceKey({ botId: 'b', ecosystem: 'e', instanceId: 'i' })
    const b = formatGlueInstanceKey({ botId: 'b', ecosystem: 'e', instanceId: 'j' })
    expect(a).not.toBe(b)
  })

  it('readTokenFromEnv returns undefined for missing', () => {
    const name = `__MISSING_TOKEN_${Date.now()}__`
    expect(readTokenFromEnv(name)).toBeUndefined()
  })
})
