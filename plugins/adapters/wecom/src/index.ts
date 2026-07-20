export {
  buildSendRequestBody,
  decryptMessage,
  extractEncryptFromXml,
  formatInboundContent,
  formatOutboundBody,
  getAesKey,
  normalizeEchostrParam,
  normalizeWebhookPath,
  parseXmlMessage,
  queryParam,
  readTextBody,
  resolveChatType,
  resolveWecomConfig,
  verifySignature,
  type AccessToken,
  type ResolvedWecomConfig,
  type WecomAdapterConfig,
  type WecomApiResponse,
  type WecomMessage,
  type WecomSendBody,
  type WecomWireSegment,
} from './protocol.js';

export {
  getWecomAgentDeps,
  registerWecomAgentEndpoint,
  setWecomAgentDeps,
  type WecomAgentDeps,
  type WecomAgentEndpoint,
} from './wecom-agent-deps.js';

export {
  checkWecomPlatformPermit,
  normalizeWecomSenderForPermit,
  platformPermit,
  registerWecomPlatformPermitChecker,
  wecomGroupPermitResolver,
} from './platform-permit.js';

export {
  WecomEndpoint,
  type WecomEndpointOptions,
  type WecomFetch,
} from './endpoint.js';

export {
  registerWecomWebhookRoutes,
  handleWecomVerificationRequest,
  handleWecomWebhookRequest,
  type WecomWebhookHandler,
} from './webhook.js';
