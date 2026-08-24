export {
  formatInboundContent,
  formatOutboundText,
  resolveOutboundMessageId,
  resolveQqConfig,
  senderDisplayName,
  type QqAdapterConfig,
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
  resolveMediaFile,
  type QqOutboundElem,
  type QqOutboundMessage,
} from './outbound.js';

export {
  QqHttpEndpoint,
  QqWebsocketEndpoint,
  type CreateQqBot,
  type CreateQqHttpBot,
  type QqBotTransport,
  type QqEndpointOptions,
  type QqHttpBotTransport,
  type QqHttpEndpointOptions,
} from './endpoint.js';

export {
  registerQqWebhookRoutes,
  handleQqWebhookRequest,
  readRequestBodyText,
  defaultCreateHttpBot,
  type QqWebhookHandler,
} from './webhook.js';

export {
  bindQqBotInboundEvents,
  defaultCreateBot,
  normalizeQqMessage,
} from './ws.js';

export { qqClient, type QqClientEventMap } from './client.js';

export {
  checkQqPlatformPermit,
  normalizeQqGuildSenderForPermit,
  platformPermit,
  qqGuildPermitResolver,
} from './platform-permit.js';
