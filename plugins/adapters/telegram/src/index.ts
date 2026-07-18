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
  normalizeWebhookPath,
  resolveChannel,
  resolveTelegramConfig,
  senderDisplayName,
  type ResolvedTelegramConfig,
  type TelegramAdapterConfig,
  type TelegramCallbackQuery,
  type TelegramChat,
  type TelegramChatMember,
  type TelegramMessage,
  type TelegramOutboundAction,
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
