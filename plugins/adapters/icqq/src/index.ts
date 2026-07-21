export {
  Actions,
  formatInboundContent,
  formatInboundTarget,
  formatOutboundBody,
  parseSendTarget,
  resolveIcqqConfig,
  type IcqqAdapterConfig,
  type IcqqInboundMessage,
  type IcqqWireSegment,
  type IpcEvent,
  type IpcMessage,
  type IpcRequest,
  type IpcResponse,
  type ParsedIcqqSendTarget,
  type ResolvedIcqqConfig,
} from './protocol.js';

export {
  IcqqIpcEndpoint,
  type CreateIcqqIpc,
  type IcqqEndpointOptions,
  type IcqqInboxHooks,
  type IcqqIpcTransport,
} from './endpoint.js';

export * from './types.js';

export {
  getIcqqAgentDeps,
  registerIcqqAgentEndpoint,
  setIcqqAgentDeps,
  type IcqqAgentDeps,
  type IcqqAgentEndpoint,
} from './icqq-agent-deps.js';

export { IpcClient } from './ipc-client.js';
export {
  resolveIcqqInboundMessageId,
} from './icqq-inbound.js';
