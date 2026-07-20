export {
  formatInboundContent,
  formatInboundTarget,
  formatOutboundText,
  parseSendTarget,
  resolveOutboundMessageId,
  resolveQqConfig,
  senderDisplayName,
  type ParsedSendTarget,
  type QqAdapterConfig,
  type QqChannelKind,
  type QqInboundMessage,
  type QqWireSegment,
  type ResolvedQqConfig,
  type ResolvedQqHttpConfig,
  type ResolvedQqWebsocketConfig,
} from './protocol.js';

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

export {
  getQqAgentDeps,
  registerQqAgentEndpoint,
  setQqAgentDeps,
  type QqAgentDeps,
  type QqAgentEndpoint,
} from './qq-agent-deps.js';

export {
  checkQqPlatformPermit,
  normalizeQqGuildSenderForPermit,
  platformPermit,
  qqGuildPermitResolver,
  registerQqPlatformPermitChecker,
} from './platform-permit.js';
