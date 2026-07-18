export {
  formatInboundContent,
  formatInboundTarget,
  formatOutboundKmarkdown,
  parseSendTarget,
  resolveKookConfig,
  senderDisplayName,
  KookPermission,
  type KookAdapterConfig,
  type KookInboundMessage,
  type KookWireSegment,
  type LogLevel,
  type ParsedSendTarget,
  type ResolvedKookConfig,
  type ResolvedKookWebhookConfig,
  type ResolvedKookWebsocketConfig,
} from './protocol.js';

export {
  KookWebhookEndpoint,
  KookWebsocketEndpoint,
  type KookEndpointOptions,
  type KookWebhookEndpointOptions,
} from './endpoint.js';

export {
  registerKookWebhookRoutes,
  handleKookWebhookRequest,
  type KookWebhookHandler,
} from './webhook.js';

export {
  defaultCreateClient,
  defaultCreateWebhookClient,
  normalizeKookMessage,
  type CreateKookClient,
  type KookClientTransport,
} from './ws.js';

export {
  getKookAgentDeps,
  registerKookAgentEndpoint,
  setKookAgentDeps,
  type KookAgentDeps,
  type KookAgentEndpoint,
} from './kook-agent-deps.js';

export {
  checkKookPlatformPermit,
  kookGroupPermitResolver,
  normalizeKookSenderForPermit,
  platformPermit,
  registerKookPlatformPermitChecker,
  type KookSenderInfo,
} from './platform-permit.js';
