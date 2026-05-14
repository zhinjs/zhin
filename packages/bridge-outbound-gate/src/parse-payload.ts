import type { BridgeOutboundIntentPayload, OutboundChannelType } from './types.js'

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const CHANNEL_TYPES = new Set<OutboundChannelType>(['group', 'private', 'channel'])

export function parseOutboundIntentPayload(
  payload: unknown,
): { ok: true; value: BridgeOutboundIntentPayload } | { ok: false; message: string } {
  if (!isPlainObject(payload)) {
    return { ok: false, message: 'payload must be a plain object' }
  }
  const { botId, ecosystem, instanceId, context, channel, content } = payload
  if (typeof botId !== 'string' || botId.length === 0) {
    return { ok: false, message: 'payload.botId must be a non-empty string' }
  }
  if (typeof ecosystem !== 'string' || ecosystem.length === 0) {
    return { ok: false, message: 'payload.ecosystem must be a non-empty string' }
  }
  if (typeof instanceId !== 'string' || instanceId.length === 0) {
    return { ok: false, message: 'payload.instanceId must be a non-empty string' }
  }
  if (typeof context !== 'string' || context.length === 0) {
    return { ok: false, message: 'payload.context must be a non-empty string' }
  }
  if (!isPlainObject(channel)) {
    return { ok: false, message: 'payload.channel must be an object' }
  }
  const ct = channel.type
  const cid = channel.id
  if (typeof ct !== 'string' || !CHANNEL_TYPES.has(ct as OutboundChannelType)) {
    return { ok: false, message: 'payload.channel.type must be group|private|channel' }
  }
  if (typeof cid !== 'string' || cid.length === 0) {
    return { ok: false, message: 'payload.channel.id must be a non-empty string' }
  }
  if (!('content' in payload)) {
    return { ok: false, message: 'payload.content is required' }
  }
  return {
    ok: true,
    value: {
      botId,
      ecosystem,
      instanceId,
      context,
      channel: { type: ct as OutboundChannelType, id: cid },
      content,
    },
  }
}
