import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { BridgeParentSession, isOutboundIntentEnvelope } from '@zhin.js/bridge-ipc'
import { OutboundGate } from '@zhin.js/bridge-outbound-gate'
import type { BridgeOutboundNormalizedSend } from '@zhin.js/bridge-outbound-gate'

import { MIAO_TRACER_CONFIG_ENV } from './index.js'

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const childPath = path.resolve(pkgRoot, 'bin/miao-tracer-child.mjs')
const pluginPath = path.resolve(pkgRoot, 'fixtures/tracer-echo-plugin.mjs')

const skipE2e = process.env.SKIP_BRIDGE_MIAO_E2E === '1'

describe.skipIf(skipE2e)('bridge-miao-child e2e', () => {
  it('dispatch → allowlisted plugin → outbound_intent → OutboundGate mock send', async () => {
    const token = `tok-${Date.now()}`
    const glueKey = { botId: 'bot-a', ecosystem: 'h1', instanceId: 'miaov1' }
    const cfg = {
      pluginAllowlist: [pluginPath],
      glueKey,
      context: 'miao',
    }

    const session = await BridgeParentSession.spawn({
      command: process.execPath,
      args: [childPath],
      token,
      cwd: pkgRoot,
      env: { ...process.env, [MIAO_TRACER_CONFIG_ENV]: JSON.stringify(cfg) },
    })

    const outbound: unknown[] = []
    session.on('record', (rec) => {
      if (isOutboundIntentEnvelope(rec)) outbound.push(rec)
    })

    const send = vi.fn(async (_s: BridgeOutboundNormalizedSend) => {})
    const gate = new OutboundGate({
      glueKey,
      policy: {
        allowedChannelTypes: ['private', 'group', 'channel'],
        allowedIdsByType: { private: new Set(['u1']), group: new Set(['g1']) },
      },
      rateLimit: { windowMs: 60_000, maxAttempts: 100 },
      send,
    })

    const dispatchId = session.sendDispatch({ event: 'message', user_id: 'u1', text: 'ping' })
    await session.waitForDispatchResult(dispatchId, 5000)

    expect(outbound.length).toBe(1)
    const r = await gate.submit(outbound[0])
    expect(r).toEqual({ ok: true })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].channel).toEqual({ type: 'private', id: 'u1' })
    expect(send.mock.calls[0][0].content).toEqual({ text: 'miao-tracer:ping' })

    await session.close()
  })
})
