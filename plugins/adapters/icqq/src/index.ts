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
} from './endpoint.js';

export * from './types.js';

export {
  icqqClient,
  type IcqqClient,
  type IcqqClientEventMap,
} from './client.js';

export {
  resolveIcqqInboundMessageId,
} from './icqq-inbound.js';
