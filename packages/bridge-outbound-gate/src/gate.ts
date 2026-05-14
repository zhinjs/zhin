import { isOutboundIntentEnvelope } from '@zhin.js/bridge-ipc'
import type { BridgeGlueInstanceKey } from '@zhin.js/bridge-supervisor'

import { parseOutboundIntentPayload } from './parse-payload.js'
import { SlidingWindowRateLimiter } from './rate-limit.js'
import type {
  BridgeOutboundNormalizedSend,
  OutboundChannelType,
  OutboundDestinationPolicy,
  OutboundGateOptions,
  OutboundGateResult,
  SendExecutor,
} from './types.js'

function keysMatch(a: BridgeGlueInstanceKey, b: BridgeGlueInstanceKey): boolean {
  return a.botId === b.botId && a.ecosystem === b.ecosystem && a.instanceId === b.instanceId
}

function checkChannelPolicy(
  policy: OutboundDestinationPolicy,
  channel: { type: OutboundChannelType; id: string },
): { ok: true } | { ok: false; code: 'invalid_channel_type' | 'invalid_channel_destination'; message?: string } {
  if (!policy.allowedChannelTypes.includes(channel.type)) {
    return { ok: false, code: 'invalid_channel_type', message: `channel type ${channel.type} is not allowed` }
  }
  const allowIds = policy.allowedIdsByType?.[channel.type]
  if (allowIds !== undefined && !allowIds.has(channel.id)) {
    return {
      ok: false,
      code: 'invalid_channel_destination',
      message: `channel id is not allowed for type ${channel.type}`,
    }
  }
  return { ok: true }
}

export class OutboundGate {
  readonly #glueKey: BridgeGlueInstanceKey
  readonly #policy: OutboundDestinationPolicy
  readonly #send: SendExecutor
  readonly #limiter: SlidingWindowRateLimiter

  constructor(options: OutboundGateOptions) {
    this.#glueKey = options.glueKey
    this.#policy = options.policy
    this.#send = options.send
    this.#limiter = new SlidingWindowRateLimiter(
      options.rateLimit.windowMs,
      options.rateLimit.maxAttempts,
      options.now,
    )
  }

  /**
   * Validate a wire-level or already-parsed `outbound_intent` record, apply rate limit,
   * then invoke {@link SendExecutor} with a Core-shaped normalized payload.
   */
  async submit(envelope: unknown): Promise<OutboundGateResult> {
    if (!isOutboundIntentEnvelope(envelope)) {
      return { ok: false, code: 'invalid_envelope', message: 'not a valid outbound_intent envelope' }
    }
    const parsed = parseOutboundIntentPayload(envelope.payload)
    if (!parsed.ok) {
      return { ok: false, code: 'invalid_payload', message: parsed.message }
    }
    const p = parsed.value
    const glueFromPayload: BridgeGlueInstanceKey = {
      botId: p.botId,
      ecosystem: p.ecosystem,
      instanceId: p.instanceId,
    }
    if (!keysMatch(glueFromPayload, this.#glueKey)) {
      return { ok: false, code: 'invalid_bot', message: 'bot identity does not match this gate' }
    }
    const ch = checkChannelPolicy(this.#policy, p.channel)
    if (!ch.ok) {
      return { ok: false, code: ch.code, message: ch.message }
    }
    if (!this.#limiter.tryTake()) {
      return { ok: false, code: 'rate_limited', message: 'rate limit exceeded' }
    }
    const normalized: BridgeOutboundNormalizedSend = {
      intentId: envelope.id,
      glueKey: this.#glueKey,
      bot: p.botId,
      context: p.context,
      channel: p.channel,
      content: p.content,
    }
    if (envelope.correlationId !== undefined) {
      normalized.correlationId = envelope.correlationId
    }
    await this.#send(normalized)
    return { ok: true }
  }
}
