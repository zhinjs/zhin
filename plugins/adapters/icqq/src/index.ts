export {
  Actions,
  formatInboundContent,
  formatOutboundBody,
  icqqInboundConversation,
  icqqOutboundTarget,
  type ActionResult,
  type IcqqAdapterConfig,
  type IcqqInboundMessage,
  type IcqqWireSegment,
  type ParsedIcqqSendTarget,
  type ResolvedIcqqConfig,
} from './protocol.js';

export {
  IcqqEndpoint,
  type IcqqEndpointOptions,
  type IcqqInboxHooks,
} from './endpoint.js';

export * from './types.js';

export {
  getIcqqAgentDeps,
  registerIcqqAgentEndpoint,
  setIcqqAgentDeps,
  type IcqqAgentDeps,
  type IcqqAgentEndpoint,
} from './icqq-agent-deps.js';

export {
  resolveIcqqInboundMessageId,
} from './icqq-inbound.js';
