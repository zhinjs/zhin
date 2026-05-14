import { describe, expect, it, vi } from 'vitest'

import { OutboundGate } from './gate.js'
import type { BridgeOutboundNormalizedSend } from './types.js'

const glueKey = { botId: 'bot-a', ecosystem: 'nb2', instanceId: 'inst-1' }

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    botId: 'bot-a',
    ecosystem: 'nb2',
    instanceId: 'inst-1',
    context: 'onebot',
    channel: { type: 'private' as const, id: 'user-1' },
    content: { text: 'hi' },
    ...overrides,
  }
}

function basePolicy() {
  return {
    allowedChannelTypes: ['private', 'group', 'channel'] as const,
    allowedIdsByType: {
      private: new Set(['user-1']),
      group: new Set(['g-1']),
    } as const,
  }
}

describe('OutboundGate', () => {
  it('forwards a valid intent to SendExecutor with normalized Core-shaped payload', async () => {
    const send = vi.fn(async (_s: BridgeOutboundNormalizedSend) => {})
    const gate = new OutboundGate({
      glueKey,
      policy: basePolicy(),
      rateLimit: { windowMs: 60_000, maxAttempts: 100 },
      send,
    })
    const r = await gate.submit({
      kind: 'outbound_intent',
      id: 'i1',
      source: 'im',
      correlationId: 'corr-99',
      payload: basePayload(),
    })
    expect(r).toEqual({ ok: true })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toEqual({
      intentId: 'i1',
      correlationId: 'corr-99',
      glueKey,
      bot: 'bot-a',
      context: 'onebot',
      channel: { type: 'private', id: 'user-1' },
      content: { text: 'hi' },
    })
  })

  it('rejects invalid bot identity', async () => {
    const send = vi.fn()
    const gate = new OutboundGate({
      glueKey,
      policy: basePolicy(),
      rateLimit: { windowMs: 60_000, maxAttempts: 100 },
      send,
    })
    const r = await gate.submit({
      kind: 'outbound_intent',
      id: 'i1',
      source: 'im',
      payload: basePayload({ botId: 'other' }),
    })
    expect(r).toEqual({
      ok: false,
      code: 'invalid_bot',
      message: 'bot identity does not match this gate',
    })
    expect(send).not.toHaveBeenCalled()
  })

  it('rejects disallowed channel type', async () => {
    const send = vi.fn()
    const gate = new OutboundGate({
      glueKey,
      policy: {
        allowedChannelTypes: ['private'],
        allowedIdsByType: { private: new Set(['user-1']) },
      },
      rateLimit: { windowMs: 60_000, maxAttempts: 100 },
      send,
    })
    const r = await gate.submit({
      kind: 'outbound_intent',
      id: 'i1',
      source: 'im',
      payload: basePayload({ channel: { type: 'group', id: 'g-1' } }),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('invalid_channel_type')
    }
    expect(send).not.toHaveBeenCalled()
  })

  it('rejects channel id outside allowlist for that type', async () => {
    const send = vi.fn()
    const gate = new OutboundGate({
      glueKey,
      policy: basePolicy(),
      rateLimit: { windowMs: 60_000, maxAttempts: 100 },
      send,
    })
    const r = await gate.submit({
      kind: 'outbound_intent',
      id: 'i1',
      source: 'im',
      payload: basePayload({ channel: { type: 'private', id: 'stranger' } }),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('invalid_channel_destination')
    }
    expect(send).not.toHaveBeenCalled()
  })

  it('enforces sliding-window rate limit after validation', async () => {
    let now = 1_000_000
    const send = vi.fn(async () => {})
    const gate = new OutboundGate({
      glueKey,
      policy: basePolicy(),
      rateLimit: { windowMs: 10_000, maxAttempts: 2 },
      send,
      now: () => now,
    })
    const env = () =>
      ({
        kind: 'outbound_intent',
        id: 'ix',
        source: 'im',
        payload: basePayload(),
      }) as const

    expect(await gate.submit({ ...env(), id: 'a' })).toEqual({ ok: true })
    expect(await gate.submit({ ...env(), id: 'b' })).toEqual({ ok: true })
    const blocked = await gate.submit({ ...env(), id: 'c' })
    expect(blocked).toEqual({
      ok: false,
      code: 'rate_limited',
      message: 'rate limit exceeded',
    })
    expect(send).toHaveBeenCalledTimes(2)

    now += 11_000
    expect(await gate.submit({ ...env(), id: 'd' })).toEqual({ ok: true })
    expect(send).toHaveBeenCalledTimes(3)
  })

  it('allows proactive outbound without correlationId (I2)', async () => {
    const send = vi.fn(async (_s: BridgeOutboundNormalizedSend) => {})
    const gate = new OutboundGate({
      glueKey,
      policy: basePolicy(),
      rateLimit: { windowMs: 60_000, maxAttempts: 100 },
      send,
    })
    const r = await gate.submit({
      kind: 'outbound_intent',
      id: 'pro-1',
      source: 'im',
      payload: basePayload(),
    })
    expect(r).toEqual({ ok: true })
    const arg = send.mock.calls[0][0]
    expect(arg.correlationId).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(arg, 'correlationId')).toBe(false)
  })
})
