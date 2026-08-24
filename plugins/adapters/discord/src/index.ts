export {
  activityTypeCode,
  formatButtonContent,
  formatInboundContent,
  formatOutboundBody,
  resolveChannelKind,
  resolveDiscordConfig,
  senderDisplayName,
  type DiscordAdapterConfig,
  type DiscordButtonInbound,
  type DiscordInboundAttachment,
  type DiscordInboundMessage,
  type DiscordOutboundBody,
  type DiscordWireSegment,
  type ResolvedDiscordConfig,
  type ResolvedDiscordGatewayConfig,
  type ResolvedDiscordInteractionsConfig,
} from './protocol.js';

export {
  discordClient,
  type DiscordClient,
  type DiscordClientEventMap,
} from './client.js';

export {
  checkDiscordPlatformPermit,
  discordGroupPermitResolver,
  normalizeDiscordSenderForPermit,
  platformPermit,
} from './platform-permit.js';

export {
  DiscordGatewayEndpoint,
  DiscordInteractionsEndpoint,
  type CreateDiscordClient,
  type DiscordClientTransport,
  type DiscordEndpointOptions,
  type DiscordInteractionsEndpointOptions,
} from './endpoint.js';

export {
  connectDiscordGatewayClient,
  defaultCreateClient,
  normalizeDiscordMessage,
  resolveSenderRole,
  toMessageCreateOptions,
  type DiscordGatewayConnectHandlers,
} from './gateway.js';

export {
  handleDiscordInteractionRequest,
  registerDiscordInteractionRoutes,
  type DiscordInteractionsHandler,
} from './webhook.js';
