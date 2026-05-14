import type { BridgeGlueInstanceKey } from '@zhin.js/bridge-supervisor'

/** Aligns with Core `MessageType` / `SendOptions` channel discriminator. */
export type OutboundChannelType = 'group' | 'private' | 'channel'

/** Parsed child `outbound_intent` payload (before policy / bot checks). */
export interface BridgeOutboundIntentPayload {
  botId: string
  ecosystem: string
  instanceId: string
  /** Core `SendOptions.context` (adapter / platform id). */
  context: string
  channel: {
    type: OutboundChannelType
    id: string
  }
  content: unknown
}

/**
 * Normalized outbound send passed to {@link SendExecutor} (maps to Core `SendOptions`:
 * `bot`, `context`, `channel`, `content`).
 */
export interface BridgeOutboundNormalizedSend {
  intentId: string
  correlationId?: string
  glueKey: BridgeGlueInstanceKey
  bot: string
  context: string
  channel: {
    type: OutboundChannelType
    id: string
  }
  content: unknown
}

export type SendExecutor = (send: BridgeOutboundNormalizedSend) => Promise<void>

/**
 * Destination policy after bot triple matches the gate: channel type allowlist plus
 * optional per-type id allowlists (omit a type to allow any id for that type).
 */
export interface OutboundDestinationPolicy {
  allowedChannelTypes: ReadonlyArray<OutboundChannelType>
  allowedIdsByType?: Partial<Readonly<Record<OutboundChannelType, ReadonlySet<string>>>>
}

export type OutboundGateRejectCode =
  | 'invalid_envelope'
  | 'invalid_payload'
  | 'invalid_bot'
  | 'invalid_channel_type'
  | 'invalid_channel_destination'
  | 'rate_limited'

export type OutboundGateResult =
  | { ok: true }
  | { ok: false; code: OutboundGateRejectCode; message?: string }

export interface OutboundGateOptions {
  glueKey: BridgeGlueInstanceKey
  policy: OutboundDestinationPolicy
  rateLimit: {
    windowMs: number
    maxAttempts: number
  }
  send: SendExecutor
  /** Injected clock for deterministic rate-limit tests */
  now?: () => number
}
