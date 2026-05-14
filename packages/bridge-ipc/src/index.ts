export { BRIDGE_PROTOCOL_VERSION } from './types.js'
export type {
  BridgeDispatchEnvelope,
  BridgeDispatchResultEnvelope,
  BridgeHelloError,
  BridgeHelloErrorCode,
  BridgeHelloOk,
  BridgeHelloParent,
  BridgeMessageSource,
  BridgeOutboundIntentEnvelope,
} from './types.js'
export { isOutboundIntentEnvelope } from './types.js'
export { BridgeEofError, BridgeFrameError, BridgeHandshakeError, type BridgeHandshakeFailureCode } from './errors.js'
export { encodeNdjsonRecord, parseNdjsonLine, readNdjsonLines } from './framing.js'
export {
  BridgeParentSession,
  type BridgeParentHandshakeOptions,
  type BridgeParentSpawnOptions,
  type BridgeParentEvents,
} from './session.js'
