export {
  TelegramEndpoint,
  type TelegramEndpointOptions,
  type TelegramFetch,
} from './endpoint.js';

export {
  botApiUrl,
  formatCallbackContent,
  formatInboundContent,
  formatOutboundActions,
  formatOutboundPlan,
  normalizeWebhookPath,
  resolveTelegramConfig,
  senderDisplayName,
  type ResolvedTelegramConfig,
  type TelegramAdapterConfig,
  type TelegramCallbackQuery,
  type TelegramChat,
  type TelegramChatMember,
  type TelegramMessage,
  type TelegramOutboundAction,
  type TelegramOutboundPlan,
  type TelegramOutboundUpload,
  type TelegramUpdate,
  type TelegramUser,
  type TelegramWireSegment,
} from './protocol.js';

export {
  getTelegramAgentDeps,
  registerTelegramAgentEndpoint,
  setTelegramAgentDeps,
  type TelegramAgentDeps,
  type TelegramAgentEndpoint,
} from './telegram-agent-deps.js';

export {
  checkTelegramPlatformPermit,
  normalizeTelegramChatMember,
  platformPermit,
  registerTelegramPlatformPermitChecker,
  telegramGroupPermitResolver,
} from './platform-permit.js';
