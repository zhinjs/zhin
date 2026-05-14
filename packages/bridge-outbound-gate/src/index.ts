export { OutboundGate } from './gate.js'
export { SlidingWindowRateLimiter } from './rate-limit.js'
export { parseOutboundIntentPayload } from './parse-payload.js'
export type {
  BridgeOutboundIntentPayload,
  BridgeOutboundNormalizedSend,
  OutboundChannelType,
  OutboundDestinationPolicy,
  OutboundGateOptions,
  OutboundGateRejectCode,
  OutboundGateResult,
  SendExecutor,
} from './types.js'
