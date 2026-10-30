export {
  formatInboundContent,
  formatOutboundKmarkdown,
  resolveKookConfig,
  senderDisplayName,
  KookPermission,
  type KookEndpointConfig,
  type KookInboundMessage,
  type KookWireSegment,
  type LogLevel,
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
  kookWebsocketClientOptions,
  kookWebhookClientOptions,
  normalizeKookMessage,
  type KookClientTransport,
} from './ws.js';

export { type KookClientEventMap } from './client.js';
export { KookAdapter } from './adapter.js';

export {
  checkKookPlatformPermit,
  kookGroupPermitResolver,
  normalizeKookSenderForPermit,
  platformPermit,
  type KookSenderInfo,
} from './platform-permit.js';
