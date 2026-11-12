/** `@zhin.js/host-http/bridge` — gateway ↔ instance control channel and HTTP bridge (ADR 0054 §3). */
export * from './protocol.js';
export * from './control-channel.js';
export {
  BridgeStreamClosedError,
  CreditGate,
  InboundBody,
  ownBytes,
  pumpBody,
  type InboundBodyOptions,
  type PumpBodyOptions,
} from './flow.js';
export {
  createBridgedHttpHost,
  PRINCIPAL_REVOKED_CLOSE_CODE,
  sendableCloseCode,
  type BridgeChannel,
  type BridgedHttpHost,
  type BridgedHttpHostOptions,
} from './bridged-host.js';
export {
  InstanceTransportError,
  IpcInstanceTransport,
  type GatewayInstancePort,
  type InstanceChildProcessLike,
  type InstanceRequestContext,
  type InstanceTransport,
  type InstanceTransportErrorCode,
  type InstanceWsOpenInfo,
  type IpcInstanceTransportOptions,
} from './instance-transport.js';
