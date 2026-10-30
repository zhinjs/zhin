export {
  Actions,
  formatInboundContent,
  formatOutboundBody,
  formatOutboundMessages,
  formatOutboundMessageParts,
  icqqInboundConversation,
  icqqOutboundTarget,
  type ActionResult,
  type IcqqEndpointConfig,
  type IcqqInboundMessage,
  type IcqqWireSegment,
  type IcqqOutboundMessagePart,
  type ParsedIcqqSendTarget,
  type ResolvedIcqqConfig,
} from './protocol.js';

export {
  IcqqEndpoint,
  type IcqqEndpointOptions,
} from './endpoint.js';

export * from './types.js';

export {
  type IcqqClient,
  type IcqqClientEventMap,
} from './client.js';

export {
  resolveIcqqInboundMessageId,
} from './icqq-inbound.js';

export { IcqqAdapter } from './adapter.js';
