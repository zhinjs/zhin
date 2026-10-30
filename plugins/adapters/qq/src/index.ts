export {
  formatInboundContent,
  formatOutboundText,
  resolveOutboundMessageId,
  resolveQqConfig,
  senderDisplayName,
  type QqEndpointConfig,
  type QqChannelKind,
  type QqInboundMessage,
  type QqWireSegment,
  type ResolvedQqConfig,
  type ResolvedQqHttpConfig,
  type ResolvedQqWebsocketConfig,
} from './protocol.js';

export {
  DEFAULT_QQ_BOT_KIND,
  QQ_INTENTS_BY_KIND,
  defaultQqEndpointIntentFields,
  parseQqBotKind,
  resolveQqIntents,
  type QqBotKind,
  type QqIntent,
} from './qq-intents.js';

export {
  formatOutbound,
  formatOutboundMessages,
  collectOutboundImageSizes,
  type FormatOutboundMessagesOptions,
  resolveMediaFile,
  type QqOutboundElem,
  type QqOutboundMessage,
} from './outbound.js';

export { imageSizeFromBytes, probeImageSize, type QqImageSize } from './image-size.js';

export {
  QqHttpEndpoint,
  QqWebsocketEndpoint,
  type QqBotTransport,
  type QqOfficialApi,
  type QqEndpointOptions,
  type QqHttpBotTransport,
  type QqHttpEndpointOptions,
} from './endpoint.js';

export {
  registerQqWebhookRoutes,
  handleQqWebhookRequest,
  readRequestBodyText,
  qqHttpBotOptions,
  type QqWebhookHandler,
} from './webhook.js';

export {
  bindQqBotInboundEvents,
  qqWebsocketBotOptions,
  normalizeQqMessage,
} from './ws.js';

export { type QqClientEventMap } from './client.js';

export {
  checkQqPlatformPermit,
  normalizeQqGuildSenderForPermit,
  platformPermit,
  qqGuildPermitResolver,
} from './platform-permit.js';

export { QqAdapter } from './adapter.js';
